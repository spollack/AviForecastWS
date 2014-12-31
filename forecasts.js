//
// exports
//
var forecasts = module.exports = {};


//
// required packages
//
var fs = require('fs');
var winston = require('winston');
var request = require('request');
var moment = require('moment');
var underscore = require('underscore');
var async = require('async');
var xml2js = require('xml2js');
var cheerio = require('cheerio');


// avi danger levels
forecasts.AVI_LEVEL_UNKNOWN = 0;
forecasts.AVI_LEVEL_LOW = 1;
forecasts.AVI_LEVEL_MODERATE = 2;
forecasts.AVI_LEVEL_CONSIDERABLE = 3;
forecasts.AVI_LEVEL_HIGH = 4;
forecasts.AVI_LEVEL_EXTREME = 5;

// time intervals
// NOTE to ensure forecasts get generated, ensure FORECAST_GEN_INTERVAL_SECONDS >> DATA_REQUEST_TIMEOUT_SECONDS
// NOTE the total delay that a client might see from forecast issued to available at client is the sum
// of FORECAST_GEN_INTERVAL_SECONDS + CACHE_MAX_AGE_SECONDS
forecasts.DATA_REQUESTS_IN_PARALLEL = 10;
forecasts.DATA_REQUEST_TIMEOUT_SECONDS = 15;
forecasts.FORECAST_GEN_INTERVAL_SECONDS = 300;
forecasts.CACHE_MAX_AGE_SECONDS = 60;

// filepaths
forecasts.STATIC_FILES_DIR_PATH  = __dirname + '/public';
forecasts.REGIONS_PATH = __dirname + '/public/v1/regions.json';
forecasts.FORECASTS_DATA_PATH = __dirname + '/public/v1/forecasts.json';
forecasts.FORECASTS_DATA_TEMP_PATH = __dirname + '/public/v1/forecasts_TEMP.json';
forecasts.TEMPLATE_FILES_DIR_PATH  = __dirname + '/templates';


// generated forecast tracking
// NOTE these are only kept for the life of a single process, not across process restarts
forecasts.forecastGenerationCount = 0;
forecasts.mostRecentForecasts = [];


forecasts.aggregateForecasts = function(regions) {

    winston.info('aggregateForecasts: initiated');

    var startTime = new Date();
    var forecastsArray = [];
    var invalidCount = 0;

    async.forEachLimit(
        regions,
        forecasts.DATA_REQUESTS_IN_PARALLEL,
        function(region, callback) {
            var regionId = region.regionId;
            forecasts.forecastForRegionId(regionId, function(forecast) {

                // sanity check the forecast
                var valid = forecasts.validateForecast(regionId, forecast, true);
                if (!valid) {
                    invalidCount++;
                }
                
                // add the forecast to the forecasts array
                // NOTE the order of forecast generation completion is not deterministic, so they may end up in any
                // order in the array
                forecastsArray.push({regionId:regionId, forecast:forecast});

                winston.info('generated forecast for regionId: ' + regionId + '; count generated so far: ' + forecastsArray.length);
                
                // continue even on error
                callback(null);
            });
        },
        function() {
            var endTime = new Date();
            var elapsedTime = endTime.getTime() - startTime.getTime();
            if (regions.length !== forecastsArray.length) {
                winston.warn('aggregateForecasts: forecast generation error, expected count of forecasts: ' + regions.length + '; actual: ' + forecastsArray.length);
            }
            winston.info('aggregateForecasts: all forecasts processed, region count: ' + forecastsArray.length + '; elapsed time (ms): ' + elapsedTime);
            if (invalidCount > 0) {
                winston.warn('aggregateForecasts: there were invalid forecasts; invalid forecast count: ' + invalidCount);
            } else {
                winston.info('aggregateForecasts: all forecasts valid');
            }

            // write the forecasts out to a static json file, that can be served by the HTTP server

            // NOTE to ensure atomicity at the filesystem level, we write out to a temporary file, and
            // then move it into place, overwriting the old file

            fs.writeFile(forecasts.FORECASTS_DATA_TEMP_PATH, JSON.stringify(forecastsArray, null, 4), 'utf8',
                function() {
                    fs.rename(forecasts.FORECASTS_DATA_TEMP_PATH, forecasts.FORECASTS_DATA_PATH,
                        function() {
                            winston.info('aggregateForecasts: forecast data file updated; path: ' + forecasts.FORECASTS_DATA_PATH);
                            forecasts.forecastGenerationCount++;
                        }
                    );
                }
            );
        }
    );
};

forecasts.validateForecast = function(regionId, forecast, validateForCurrentDay) {

    // BUGBUG how do we deal with centers shutting down for the season???

    var validForecast = true;

    if (!forecast) {
        // check for null forecast

        // NOTE known exceptions: these regions currently do not provide any danger level ratings
        if (regionId === 'cacb_north-rockies' || regionId === 'cacb_yukon' || regionId === 'cnfaic_summit' || regionId === 'vac_1' ||
            regionId === 'aac_1' || regionId === 'cac2_1' || regionId === 'hpac_1' || regionId === 'kpac_1' ||
            regionId.split('_')[0] === 'wac') {
            winston.info('forecast validation: as expected, got null forecast; regionId: ' + regionId);
        } else {
            validForecast = false;
            winston.warn('forecast validation: UNEXPECTED got null forecast; regionId: ' + regionId);
        }
    } else {
        // check forecast contents
        var i;

        // dates should be sequential, with no gaps
        var firstDate = forecast[0].date;
        for (i = 0; i < forecast.length; i++) {

            var expectedDate = moment(firstDate, 'YYYY-MM-DD').add(i, 'days').format('YYYY-MM-DD');
            if (expectedDate !== forecast[i].date) {
                validForecast = false;
                winston.warn('forecast validation: UNEXPECTED date for regionId: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
                break;
            }
        }

        // aviLevel should never be null
        for (i = 0; i < forecast.length; i++) {
            if (forecast[i].aviLevel === null) {
                winston.warn('forecast validation: UNEXPECTED BUG!!! got aviLevel null in forecast; regionId: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
                break;
            }
        }

        // aviLevel should not be AVI_LEVEL_UNKNOWN
        for (i = 0; i < forecast.length; i++) {
            if (forecast[i].aviLevel === forecasts.AVI_LEVEL_UNKNOWN) {
                // NOTE known exceptions: certain regions always/sometimes posts forecasts with a valid issued date but 
                // without danger level ratings
                if (regionId === 'caic_9' || regionId === 'uac_skyline' || regionId === 'uac_moab_1' || regionId === 'uac_moab_2' || 
                    regionId === 'snfac_4') {
                    winston.info('forecast validation: as expected, got aviLevel 0 in forecast; regionId: ' + regionId);
                } else {
                    validForecast = false;
                    winston.warn('forecast validation: UNEXPECTED got aviLevel 0 in forecast; regionId: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
                    break;
                }
            }
        }

        // if things look good so far, continue the validation
        if (validForecast && validateForCurrentDay) {
            validForecast = forecasts.validateForecastForCurrentDay(regionId, forecast);
        }
    }

    return validForecast;
};

forecasts.validateForecastForCurrentDay = function(regionId, forecast) {
    
    // BUGBUG when run early in the morning, some centers haven't issued their forecasts for the day yet...

    var validForecast = false;

    if (forecast) {
        // get the current date
        // NOTE timezones are tricky... first offset by the timezone that the environment is in to get back to UTC time,
        // then offset to get to PST, which is what we use for our checking (close enough for now)
        var timezoneOffsetMinutes = moment().zone();
        var pstOffsetMinutes = 8 * 60;
        var currentPSTDate = moment().add(timezoneOffsetMinutes, 'minutes').subtract(pstOffsetMinutes, 'minutes').format('YYYY-MM-DD');
        winston.verbose('forecast validation: right now the PST date is: ' + currentPSTDate);

        for (var i = 0; i < forecast.length; i++) {
            if (forecast[i].date === currentPSTDate) {
                validForecast = true;
                winston.info('forecast validation: as expected, found forecast for current day; regionId: ' + regionId);
                break;
            }
        }

        if (!validForecast) {
            // NOTE known exceptions: certain regions do not issue new forecasts daily, so this case can happen
            if (regionId === 'uac_moab_1' || regionId === 'uac_moab_2' || regionId === 'uac_skyline' || regionId === 'uac_uintas' || regionId === 'uac_logan'
                || regionId === 'wcmac_north' || regionId === 'wcmac_central' || regionId === 'wcmac_south'
                || regionId === 'esac_north' || regionId === 'esac_south' || regionId === 'esac_mammoth'
                || regionId === 'ipac_1' || regionId === 'ipac_2' || regionId === 'ipac_3' || regionId === 'ipac_4'
                || regionId === 'fac_1' || regionId === 'fac_2' || regionId === 'fac_3' || regionId === 'fac_4' || regionId === 'fac_5'
                || regionId === 'msac_1') {
                validForecast = true;
                winston.info('forecast validation: as expected, did not find forecast for current day; regionId: ' + regionId);
            } else {
                winston.warn('forecast validation: UNEXPECTED did not find forecast for current day; current date: ' + currentPSTDate +
                    '; regionId: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
            }
        }
    }

    return validForecast;
};

forecasts.forecastForRegionId = function(regionId, onForecast) {

    var regionDetails = forecasts.getRegionDetailsForRegionId(regionId);
    var forecast = null;

    if (!regionDetails) {
        winston.warn('invalid regionId: ' + regionId);
        process.nextTick(function() { onForecast(null); } );
    } else if (regionDetails.provider === 'uac' && forecasts.forecastGenerationCount % 6 !== 0) {
        // HACK for uac issue where they are blocking our fetches accidentally if they happen too often; so only actually
        // fetch it every N times
        
        if (forecasts.mostRecentForecasts[regionId]) {
            forecast = forecasts.mostRecentForecasts[regionId];
            winston.info('using cached value for region: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
        }
        
        process.nextTick(function() { onForecast(forecast); } );
    } else {
        var requestOptions = {
            url:regionDetails.dataURL,
            headers:{'User-Agent':'avalancheforecasts.com'},
            jar:false, 
            timeout:(forecasts.DATA_REQUEST_TIMEOUT_SECONDS * 1000)
        };

        request(requestOptions,
            function(error, response, body) {
                // BUGBUG  should check status code too, but as of 2014-12-26, PAC returns its advisory page with a 404!
                // && response.statusCode >= 200 && response.statusCode <= 299
                if (!error) {
                    winston.info('successful dataURL response; regionId: ' + regionDetails.regionId +
                        '; dataURL: ' + regionDetails.dataURL);

                    try {
                        forecast = regionDetails.parser(body, regionDetails);
                    } catch(e) {
                        winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
                    }

                    if (forecast) {
                        // cache the result
                        forecasts.mostRecentForecasts[regionId] = forecast;
                    }
                    
                    onForecast(forecast);
                } else {
                    winston.warn('failed dataURL response; regionId: ' + regionDetails.regionId + '; dataURL: ' +
                        regionDetails.dataURL + '; response status code: ' + (response ? response.statusCode : '[no response]') + '; error: ' + error);
                    
                    // if there is a cached forecast for this region, fall back to that
                    if (forecasts.mostRecentForecasts[regionId]) {
                        forecast = forecasts.mostRecentForecasts[regionId];
                        winston.info('using cached value, due to error, for region: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
                    }
                    
                    onForecast(forecast);
                }
            }
        );
    }
};

forecasts.getRegionDetailsForRegionId = function(regionId) {

    var regionDetails = null;

    if (regionId) {
        // NOTE split the regionId at the first underscore, into two pieces
        var index = regionId.indexOf('_');
        if (index !== -1) {
            var components = [regionId.slice(0, index), regionId.slice(index + 1)];

            // NOTE the URLs used here by the server for pull data may be different than the URLs for users viewing the
            // corresponding forecast as a web page
            var dataURL = null;
            var parser = null;
            switch (components[0]) {
                case 'nwac':
                    dataURL = 'http://www.nwac.us/api/v2/avalanche-region-forecast/?format=json&limit=1&zone=' + components[1];
                    parser = forecasts.parseForecast_nwac;
                    break;
                case 'cac':
                    // NOTE using existing (old) api for now, while new api stabilizes (2014-12-07)
                    dataURL = 'http://old.avalanche.ca/dataservices/cac/bulletins/xml/' + components[1];
                    parser = forecasts.parseForecast_cac;
                    break;
                case 'cacb': // CAC blog-only forecasts, which we don't parse
                    dataURL = 'http://www.avalanche.ca/blogs/' + components[1];
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'pc':
                    dataURL = 'http://avalanche.pc.gc.ca/CAAML-eng.aspx?d=TODAY&r=' + components[1];
                    parser = forecasts.parseForecast_pc;
                    break;
                case 'caic':
                    // NOTE look up the data url (because of the more complex mapping)
                    dataURL = forecasts.getDataURL_caic(components[1]);
                    parser = forecasts.parseForecast_simple_caaml;
                    break;
                case 'uac':
                    // NOTE take only the first part of the subregion
                    var subregion = components[1].split('_')[0];
                    dataURL = 'http://utahavalanchecenter.org/advisory/' + subregion + '/json';
                    parser = forecasts.parseForecast_uac;
                    break;
                case 'viac':
                    dataURL = 'http://www.islandavalanchebulletin.com/';
                    parser = forecasts.parseForecast_viac;
                    break;
                case 'sac':
                    dataURL = 'http://www.sierraavalanchecenter.org/danger-rating-rss.xml';
                    parser = forecasts.parseForecast_sac;
                    break;
                case 'esac':
                    dataURL = 'http://esavalanche.org/danger-rating-rss.xml';
                    parser = forecasts.parseForecast_esac;
                    break;
                case 'btac':
                    dataURL = 'http://www.jhavalanche.org/media/xml/' + components[1] + '_Avalanche_Forecast.xml';
                    parser = forecasts.parseForecast_simple_caaml;
                    break;
                case 'gnfac':
                    dataURL = 'http://www.mtavalanche.com/sites/default/files/xml/' + components[1] + '_Forecast.xml';
                    parser = forecasts.parseForecast_simple_caaml;
                    break;
                case 'wcmac':
                    dataURL = 'http://www.missoulaavalanche.org/advisories/feed/';
                    parser = forecasts.parseForecast_wcmac;
                    break;
                case 'snfac':
                    dataURL = 'http://sawtoothavalanche.com/caaml/SNFAC' + components[1] + '_Avalanche_Forecast.xml';
                    parser = forecasts.parseForecast_simple_caaml;
                    break;
                case 'wb':
                    dataURL = 'http://movement.whistlerblackcomb.com/avi.php';
                    parser = forecasts.parseForecast_wb;
                    break;
                case 'ipac':
                    dataURL = 'http://www.idahopanhandleavalanche.org/' + (components[1] === '1' || components[1] === '2' ? 'selkirk--cabinets' : 'st-regis-basin--silver-valley') + '.html';
                    parser = forecasts.parseForecast_ipac;
                    break;
                case 'fac':
                    var paths = {
                        1: 'http://www.flatheadavalanche.org/advisories/flathead-and-glacier-map-xml',
                        2: 'http://www.flatheadavalanche.org/advisories/whitefish-map-xml',
                        3: 'http://www.flatheadavalanche.org/advisories/swan-map-xml',
                        4: 'http://www.flatheadavalanche.org/advisories/kootenai-map-xml',
                        5: 'http://www.flatheadavalanche.org/advisories/kootenai-map-xml'
                    };
                    dataURL = paths[components[1]];
                    parser = forecasts.parseForecast_fac;
                    break;
                case 'cnfaic':
                    dataURL = 'http://www.cnfaic.org/library/rssfeed_map.php';
                    parser = forecasts.parseForecast_cnfaic;
                    break;
                case 'jac':
                    dataURL = 'http://juneau.org/avalanche/';
                    parser = forecasts.parseForecast_jac;
                    break;
                case 'aac':
                    dataURL = 'http://www.anchorageavalanchecenter.org/';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'haic':
                    dataURL = 'http://alaskasnow.org/haines/fz.kml';
                    parser = forecasts.parseForecast_haic;
                    break;
                case 'vac':
                    dataURL = 'http://www.valdezavalanchecenter.org/category/bulletin/';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'cac2':
                    dataURL = 'http://www.cityofcordova.net/residents/a-safe-cordova/avalanche-conditions';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'hpac':
                    dataURL = 'http://hatcherpassavalanchecenter.org/';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'kpac':
                    dataURL = 'http://www.kachinapeaks.org/snow-pack-summaries/';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'wac':
                    dataURL = 'http://www.wallowaavalanchecenter.org/bulletin';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'hg':
                    dataURL = 'http://www.centreavalanche.qc.ca/conditions/bulletins-avalanche/bulletin-en';
                    parser = forecasts.parseForecast_hg;
                    break;
                case 'mwac':
                    dataURL = 'http://www.mountwashingtonavalanchecenter.org/feed/';
                    parser = forecasts.parseForecast_mwac;
                    break;
                case 'msac':
                    dataURL = 'http://shastaavalanche.org/danger-rating-rss.xml';
                    parser = forecasts.parseForecast_msac;
                    break;
                case 'pac':
                    dataURL = 'http://payetteavalanche.org/advisory/';
                    parser = forecasts.parseForecast_pac;
                    break;
                default:
                    winston.warn('no match for regionId: ' + regionId);
                    break;
            }

            if (dataURL) {
                regionDetails = {'regionId': regionId, 'provider': components[0], 'subregion': components[1], 'dataURL': dataURL, 'parser': parser};
                winston.verbose('regionDetails: ' + JSON.stringify(regionDetails));
            }
        }
    }

    return regionDetails;
};

forecasts.getDataURL_caic = function(subregion) {

    var dataURL = null;
    var baseURL = 'http://avalanche.state.co.us/media/xml/';

    switch (subregion) {
        case '0a':
        case '0b':
            dataURL = baseURL + 'Steamboat_and_Flat_Tops_Avalanche_Forecast.xml';
            break;
        case '1a':
        case '1b':
            dataURL = baseURL + 'Front_Range_Avalanche_Forecast.xml';
            break;
        case '2':
            dataURL = baseURL + 'Vail_and_Summit_County_Avalanche_Forecast.xml';
            break;
        case '3':
            dataURL = baseURL + 'Sawatch_Range_Avalanche_Forecast.xml';
            break;
        case '4':
            dataURL = baseURL + 'Aspen_Avalanche_Forecast.xml';
            break;
        case '5':
            dataURL = baseURL + 'Gunnison_Avalanche_Forecast.xml';
            break;
        case '6':
            dataURL = baseURL + 'Grand_Mesa_Avalanche_Forecast.xml';
            break;
        case '7':
            dataURL = baseURL + 'Northern_San_Juan_Avalanche_Forecast.xml';
            break;
        case '8':
            dataURL = baseURL + 'Southern_San_Juan_Avalanche_Forecast.xml';
            break;
        case '9':
            dataURL = baseURL + 'Sangre_de_Cristo_Avalanche_Forecast.xml';
            break;
        default:
            winston.warn('getDataURL_caic: no match for subregion: ' + subregion);
            break;
    }

    return dataURL;
};

forecasts.findHighestAviLevelInString = function(string) {

    // NOTE looks for the *highest* avi level keyword within the string

    var aviLevel = forecasts.AVI_LEVEL_UNKNOWN;

    // various cases handled:
    // * mixed case
    // * not matching keywords showing up inside other words, like "high" in "highway"
    // * no whitespace, whitespace, or multiple whitespace
    // * multiple keywords, same or different, within the string
    if (string && typeof(string) === 'string') {
        var levelMatch = string.match(/\b(low|moderate|considerable|high|extreme)\b/gi);

        if (levelMatch && levelMatch.length > 0) {
            // scan the matches, and take the highest level found
            for (var i = 0; i < levelMatch.length; i++) {
                winston.verbose('levelMatch[' + i + ']: ' + levelMatch[i]);
                aviLevel = Math.max(aviLevel, forecasts.aviLevelFromName(levelMatch[i]));
            }
        }
    }

    return aviLevel;
};

forecasts.aviLevelFromName = function(aviLevelName) {

    // convert avi level name to number

    var aviLevel = forecasts.AVI_LEVEL_UNKNOWN;

    if (aviLevelName) {
        switch (aviLevelName.trim().toLowerCase()) {
            case 'low':
                aviLevel = forecasts.AVI_LEVEL_LOW;
                break;
            case 'moderate':
                aviLevel = forecasts.AVI_LEVEL_MODERATE;
                break;
            case 'considerable':
                aviLevel = forecasts.AVI_LEVEL_CONSIDERABLE;
                break;
            case 'high':
                aviLevel = forecasts.AVI_LEVEL_HIGH;
                break;
            case 'extreme':
                aviLevel = forecasts.AVI_LEVEL_EXTREME;
                break;
            default:
                break;
        }
    }

    return aviLevel;
};

String.prototype.trim = function() {
    return this.replace(/^\s+/, '').replace(/\s+$/, '');
};

forecasts.findAviLevelNumberInString = function(string) {

    var aviLevel = forecasts.AVI_LEVEL_UNKNOWN;

    if (string) {
        aviLevel = parseInt(string);

        // sanity check the value
        if (!(aviLevel >= forecasts.AVI_LEVEL_UNKNOWN && aviLevel <= forecasts.AVI_LEVEL_EXTREME)) {
            aviLevel = forecasts.AVI_LEVEL_UNKNOWN;
        }
    }

    return aviLevel;
};

forecasts.parseForecast_noop = function() {

    return null;
};

forecasts.parseForecast_nwac = function(body, regionDetails) {

    var forecast = null;

    try {
        // convert the JSON response to an object
        // NOTE the most recent forecast is is .objects[0]
        var bodyJson = JSON.parse(body).objects[0];

        // nwac forecasts go 2 days out; typically they are issued the evening before, for the following two days, 
        // although sometimes they are issued the same day

        var NUM_FORECAST_DAYS_NWAC = 2;

        var forecastDateDay1 = moment(bodyJson['day1_date'], 'YYYY-MM-DD').format('YYYY-MM-DD');


        forecast = [];
        for (var i = 0; i < NUM_FORECAST_DAYS_NWAC; i++) {
            // NOTE one-based index
            var forecastIndex = i + 1;
            var forecastDate = moment(forecastDateDay1).clone().add(i, 'days').format('YYYY-MM-DD');
            var aviLevel = forecasts.getAviLevelForForecastDayIndex_nwac(bodyJson, regionDetails, forecastIndex);
            forecast[i] = {'date':forecastDate, 'aviLevel':aviLevel};
        }

        // if the forecast was issued the day before the first forecast day, copy the forecast from that 
        // first forecast day into the forecast issued day too
        var forecastIssuedDate = moment(bodyJson.publish_date, 'YYYY-MM-DD HH-mm-ss');
        var dayAfterForecastIssuedDate = moment(forecastIssuedDate).clone().add(1, 'days').format('YYYY-MM-DD');
        if (dayAfterForecastIssuedDate === forecast[0].date) {
            // create an entry at the front of the forecast array for the forecast issued date, with the aviLevel of the following day
            var issuedDateForecast = {date: moment(forecastIssuedDate).format('YYYY-MM-DD'), aviLevel: forecast[0].aviLevel};
            forecast.unshift(issuedDateForecast);
        }

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    } catch (e) {
        winston.warn('failure parsing NWAC forecast; error: ' + JSON.stringify(e));
    }

    return forecast;
};

forecasts.getAviLevelForForecastDayIndex_nwac = function(bodyJson, regionDetails, forecastIndex) {

    return Math.max(
        forecasts.findHighestAviLevelInString(bodyJson['day' + forecastIndex + '_danger_elev_high']),
        forecasts.findHighestAviLevelInString(bodyJson['day' + forecastIndex + '_danger_elev_middle']),
        forecasts.findHighestAviLevelInString(bodyJson['day' + forecastIndex + '_danger_elev_low']));
};

forecasts.parseForecast_cac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            // NOTE cac uses xml namespace prefixes in their tags, which requires this byzantine lookup notation
            var dayForecasts = result['caaml:observations']['caaml:Bulletin']['caaml:bulletinResultsOf']['caaml:BulletinMeasurements']['caaml:dangerRatings']['caaml:DangerRating'];

            // NOTE create an extra slot for the day before the first described day, as sometimes the forecast is issued
            // with the first described day as the following day; we want to show some forecast for the time until
            // the following day kicks in, so we assume in this case the the danger level for the first described day
            // is also applicable to the time between when the forecast is issued and the first described day;
            forecast = [];

            for (var i = 0; i < dayForecasts.length; i++) {

                var date = forecasts.dateStringFromDateTimeString_caaml(dayForecasts[i]['gml:validTime']['gml:TimeInstant']['gml:timePosition']);

                // NOTE cac organizes forecasts by multiple elevation zones within a given day;
                // take the highest danger level listed for each day
                // NOTE not all 3 fields (Alp/Tln/Btl) are necessarily present
                var aviLevel = Math.max(
                    forecasts.findHighestAviLevelInString(dayForecasts[i]['caaml:dangerRatingAlpValue']),
                    forecasts.findHighestAviLevelInString(dayForecasts[i]['caaml:dangerRatingTlnValue']),
                    forecasts.findHighestAviLevelInString(dayForecasts[i]['caaml:dangerRatingBtlValue']));

                // NOTE copy the first described day's forecast to the day before (see note above)
                // NOTE this also assumes the days are listed in chronological order in the input data
                if (i === 0) {
                    // calculate the day before
                    var dayBeforeFirstDate = moment(date, 'YYYY-MM-DD').subtract(1, 'days');
                    forecast[0] = {'date': moment(dayBeforeFirstDate).format('YYYY-MM-DD'), 'aviLevel': aviLevel};
                }

                // put this described day in the array, shifted by one position
                forecast[i+1] = {'date': date, 'aviLevel': aviLevel};
            }

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
             }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
            forecast = null;
        }
    });

    return forecast;
};

forecasts.parseForecast_pc = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var dayForecasts = result.observations.Bulletin.bulletinResultsOf.BulletinMeasurements.dangerRatings.DangerRating;

            // NOTE create an extra slot for the day before the first described day, as sometimes the forecast is issued
            // with the first described day as the following day; we want to show some forecast for the time until
            // the following day kicks in, so we assume in this case the the danger level for the first described day
            // is also applicable to the time between when the forecast is issued and the first described day;

            forecast = [];

            // NOTE pc lists each day three times, one for each elevation zone
            for (var i = 0; i < (dayForecasts.length / 3); i++) {

                var date = forecasts.dateStringFromDateTimeString_caaml(dayForecasts[i].validTime.TimeInstant.timePosition);

                // NOTE pc organizes forecasts as separate entries for each elevation zone for each day;
                // the alpine evevation zone is always listed first, and always has the highest danger level of the
                // elevation zones, so we use it
                var aviLevel = forecasts.findAviLevelNumberInString(dayForecasts[i].mainValue);

                // NOTE copy the first described day's forcast to the day before (see note above)
                // NOTE this also assumes the days are listed in chronological order in the input data
                if (i === 0) {
                    // calculate the day before
                    var dayBeforeFirstDate = moment(date, 'YYYY-MM-DD').subtract(1, 'days');
                    forecast[0] = {'date': moment(dayBeforeFirstDate).format('YYYY-MM-DD'), 'aviLevel': aviLevel};
                }

                // put this described day in the array, shifted by one position
                forecast[i+1] = {'date': date, 'aviLevel': aviLevel};
            }

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_simple_caaml = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDate = forecasts.dateStringFromDateTimeString_caaml(result.validTime.TimePeriod.beginPosition);
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));

            var aviLevel = forecasts.findAviLevelNumberInString(result.bulletinResultsOf.BulletinMeasurements.dangerRatings.DangerRatingSingle.mainValue);

            // NOTE these sites issue avalanche forecasts for one day at a time
            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.dateStringFromDateTimeString_caaml = function(dateTimeString) {
    // NOTE typical date string: '2012-02-02T18:14:00' or '2012-02-10T00:00:00Z'
    return dateTimeString.slice(0,10);
};

forecasts.parseForecast_uac = function(body, regionDetails) {

    var forecast = null;

    try {
        // convert the JSON response to an object
        var bodyJson = JSON.parse(body);

        // NOTE uac currently issues forecasts morning of, for one day only

        var NUM_FORECAST_DAYS_UAC = 1;

        forecast = [];
        for (var i = 0; i < NUM_FORECAST_DAYS_UAC; i++) {
            // NOTE the timestamp is UTC, but we want the date in mountain time zone, so subtract 7 hours
            var mstOffsetHours = 7;
            var forecastDate = moment.unix(bodyJson.advisories[0].advisory.date_issued_timestamp).utc().subtract(mstOffsetHours, 'hours').format('YYYY-MM-DD');
            var aviLevel = forecasts.findHighestAviLevelInString(bodyJson.advisories[0].advisory.overall_danger_rating);
            forecast[i] = {'date':forecastDate, 'aviLevel':aviLevel};
        }

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    } catch (e) {
        winston.warn('failure parsing UAC forecast; error: ' + JSON.stringify(e));
    }

    return forecast;
};

forecasts.parseForecast_viac = function(body, regionDetails) {

    var forecast = null;

    var firstForecastedDate = forecasts.parseFirstForecastedDate_viac(body, regionDetails);
    var aviLevels = forecasts.parseForecastValues_viac(body, regionDetails);

    if (firstForecastedDate && aviLevels) {
        forecast = [];
        for (var i = 0; i < aviLevels.length; i++) {
            forecast[i] = {'date': moment(firstForecastedDate).clone().add(i, 'days').format('YYYY-MM-DD'), 'aviLevel': aviLevels[i]};
        }

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseFirstForecastedDate_viac = function(body, regionDetails) {

    var firstForecastedDate = null;

    // NOTE viac can issue forecasts the day before or the day of the first forecasted day; we need to correlate the
    // forecast issued date with the days of week that are described in the forecast
    var forecastIssuedDate = forecasts.parseForecastIssuedDate_viac(body, regionDetails);
    var firstForecastedDayOfWeek = forecasts.parseFirstForecastedDayOfWeek_viac(body, regionDetails);

    if (forecastIssuedDate && firstForecastedDayOfWeek) {

        var daysOfWeek = [];

        for (var i = 0; i < 2; i++) {
            // copy the value of the forecast issued date, offset by the appropriate number of days, and get the day of week
            daysOfWeek[i] = moment(forecastIssuedDate).clone().add(i, 'days');

            if (moment(daysOfWeek[i]).format('dddd').toLowerCase() === firstForecastedDayOfWeek.toLowerCase()) {
                firstForecastedDate = daysOfWeek[i];
                break;
            }
        }
    }

    return firstForecastedDate;
};

forecasts.parseForecastIssuedDate_viac = function(body, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical string: '<div title="1419028140000" class="date">December 19, 2014 at 02:29PM</div>'
    var timestampMatch = body.match(/class=\"date\">\s*(\w+\s+\d+)\w*\s*,?\s*(\d+)/i);

    // the capture groups from the regex will be in slots 1 and 2 in the array
    if (timestampMatch && timestampMatch.length > 2) {

        // capture group 1 has the month and day, capture group 2 has the year
        var cleanTimestamp = timestampMatch[1] + ' ' + timestampMatch[2];
        forecastIssuedDate = moment(cleanTimestamp, 'MMM DD YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseFirstForecastedDayOfWeek_viac = function(body, regionDetails) {

    var firstForecastedDayOfWeek = null;

    // capture the first forecasted day of week
    // NOTE typical string for viac: '<th style="background-color: #eeeeee;">Outlook</th><th style="background-color: #eeeeee;">Sunday</th><th style="background-color: #eeeeee;">Monday<br /></th><th style="background-color: #eeeeee;">Tuesday<br /></th>'
    var timestampMatch = body.match(/<th[^>]*>Outlook<\/th><th[^>]*>(\w+)<\/th>/i);

    // the capture groups from the regex will be in slot 1 in the array
    if (timestampMatch && timestampMatch.length === 2) {
        firstForecastedDayOfWeek = timestampMatch[1];
        winston.verbose('found first forecasted day of week; regionId: ' + regionDetails.regionId + '; firstForecastedDayOfWeek: ' + firstForecastedDayOfWeek);
    } else {
        winston.warn('parse failure, first forecasted day of week not found; regionId: ' + regionDetails.regionId);
    }

    return firstForecastedDayOfWeek;
};

forecasts.parseForecastValues_viac = function(body, regionDetails) {

    // viac forecasts three days at a time
    var aviLevels = [];
    for (var i = 0; i < 3; i++) {
        aviLevels[i] = forecasts.AVI_LEVEL_UNKNOWN;
    }

    // NOTE typical string for viac:
    //
    //    <tr><th style="background-color: #eeeeee;">Outlook</th><th style="background-color: #eeeeee;">Wednesday</th><th style="background-color: #eeeeee;">Thursday</th><th style="background-color: #eeeeee;">Friday</th></tr>
    //    <tr>
    //    <td style="text-align: center; font-weight: bold; padding: 5px; border: 1px solid #ffffff;"><strong style="font-size: 12px;">Alpine</strong></td>
    //    <td style="text-align: center; font-weight: bold; background-color: #a2bf57; padding: 5px; border: 1px solid #ffffff;">MODERATE</td>
    //    <td style="text-align: center; font-weight: bold; background-color: #ffdd77; padding: 5px; border: 1px solid #ffffff;">HIGH</td>
    //    <td style="text-align: center; font-weight: bold; background-color: #a2bf57; padding: 5px; border: 1px solid #ffffff;">HIGH</td>
    //    </tr>

    var dangerRatingMatch = body.match(/<td.*Alpine<\/strong><\/td>\s*\n(\s*<td.*<\/td>\s*\n)(\s*<td.*<\/td>\s*\n)(\s*<td.*<\/td>\s*\n)/i);

    // the capture groups will be in slots 1, 2, 3
    if (dangerRatingMatch && dangerRatingMatch.length === 4) {
        for (var j = 0; j < aviLevels.length; j++) {
            aviLevels[j] = forecasts.findHighestAviLevelInString(dangerRatingMatch[j+1]);
        }
    } else {
        winston.warn('parse failure, danger levels not found; regionId: ' + regionDetails.regionId);
    }

    return aviLevels;
};

forecasts.parseForecast_sac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDateField = result.channel.item.pubDate;
            // NOTE typical date string: 'Thu, 04/11/2013 - 07:00'
            var forecastIssuedDate = moment(forecastIssuedDateField, 'ddd, MM/DD/YYYY').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            var aviLevel = forecasts.findHighestAviLevelInString(result.channel.item.description);

            // NOTE sac issues single day forecasts
            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_esac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDateField = result.channel.item.pubDate;
            // NOTE typical date string: 'Thu, 04/11/2013 - 07:00'
            var forecastIssuedDate = moment(forecastIssuedDateField, 'ddd, MM/DD/YYYY').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            var aviLevel = forecasts.findHighestAviLevelInString(result.channel.item.description);

            // NOTE per request of Nate Greenberg (2013-01-01), make all esac forecasts valid for two days, unless replaced by a newer one
            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};
            forecast[1] = {'date': moment(forecastIssuedDate).clone().add(1, 'days').format('YYYY-MM-DD'), 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_wcmac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDateField = result.channel.item[0].pubDate;
            // NOTE typical date string: 'Thu, 10 Jan 2013 01:37:02 +0000'
            // NOTE timestamps in this field are UTC! need to convert to mountain standard time to get the actual publish day
            var mstOffsetHours = 7;
            var forecastIssuedDate = moment.utc(forecastIssuedDateField, 'ddd, DD MMM YYYY HH:mm:ss Z').subtract(mstOffsetHours, 'hours').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            // NOTE parse the special rating html field out of the content field
            // typical special rating html field: <div id="rating">high</div>
            var contentField = result.channel.item[0]['content:encoded'];
            var ratingMatch = contentField.match(/<div id=\"rating\">(\w+)<\/div>/i);
            
            // the capture groups from the regex will be in slot 1 in the array
            if (ratingMatch && ratingMatch.length === 2) {
                var aviLevelString = ratingMatch[1];
                var aviLevel = forecasts.findHighestAviLevelInString(aviLevelString);

                // NOTE wcmac issues single day forecasts (although not every day)
                forecast = [];
                forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};
    
                for (var j = 0; j < forecast.length; j++) {
                    winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
                }
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_wb = function(body, regionDetails) {

    var forecast = null;

    var firstForecastedDate = forecasts.parseFirstForecastedDate_wb(body, regionDetails);
    var aviLevels = forecasts.parseForecastValues_wb(body, regionDetails);

    if (firstForecastedDate && aviLevels) {
        forecast = [];
        for (var i = 0; i < aviLevels.length; i++) {
            forecast[i] = {'date': moment(firstForecastedDate).clone().add(i, 'days').format('YYYY-MM-DD'), 'aviLevel': aviLevels[i]};
        }

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseFirstForecastedDate_wb = function(body, regionDetails) {

    var firstForecastedDate = null;

    // NOTE we need to correlate the forecast issued date with the days of week that are described in the forecast
    var forecastIssuedDate = forecasts.parseForecastIssuedDate_wb(body, regionDetails);
    var firstForecastedDayOfWeek = forecasts.parseFirstForecastedDayOfWeek_wb(body, regionDetails);

    if (forecastIssuedDate && firstForecastedDayOfWeek) {

        var daysOfWeek = [];

        for (var i = 0; i < 2; i++) {
            // copy the value of the forecast issued date, offset by the appropriate number of days, and get the day of week
            daysOfWeek[i] = moment(forecastIssuedDate).clone().add(i, 'days');

            if (moment(daysOfWeek[i]).format('dddd').toLowerCase() === firstForecastedDayOfWeek.toLowerCase()) {
                firstForecastedDate = daysOfWeek[i];
                break;
            }
        }
    }

    return firstForecastedDate;
};

forecasts.parseForecastIssuedDate_wb = function(body, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical string for wb: '<p class="dstamp">Last updated: Sunday, February 03, 2013 7:20 AM</p>'
    var timestampMatch = body.match(/Last updated:\s*\w+\s*,?\s*(\w+\s+\d+)\w*\s*,?\s*(\d+)/i);

    // the capture groups from the regex will be in slots 1 and 2 in the array
    if (timestampMatch && timestampMatch.length > 2) {

        // capture group 1 has the month and day, capture group 2 has the year
        var cleanTimestamp = timestampMatch[1] + ' ' + timestampMatch[2];
        forecastIssuedDate = moment(cleanTimestamp, 'MMM DD YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseFirstForecastedDayOfWeek_wb = function(body, regionDetails) {

    var firstForecastedDayOfWeek = null;

    // capture the first forecasted day of week
    // NOTE typical string for wb: '<td><span class="title">Tuesday</span></td><td><span class="title">Wednesday</span></td><td><span class="title">Thursday</span></td>'
    // NOTE we sometimes get single quotes, sometimes double quotes, so match either
    var timestampMatch = body.match(/<td>\s*<span\s+class=.title.>(\w+)<\/span>/i);

    // the capture groups from the regex will be in slot 1 in the array
    if (timestampMatch && timestampMatch.length === 2) {
        firstForecastedDayOfWeek = timestampMatch[1];
        winston.verbose('found first forecasted day of week; regionId: ' + regionDetails.regionId + '; firstForecastedDayOfWeek: ' + firstForecastedDayOfWeek);
    } else {
        winston.warn('parse failure, first forecasted day of week not found; regionId: ' + regionDetails.regionId);
    }

    return firstForecastedDayOfWeek;
};

forecasts.parseForecastValues_wb = function(body, regionDetails) {

    // wb forecasts three days at a time
    var aviLevels = [];
    for (var i = 0; i < 3; i++) {
        aviLevels[i] = forecasts.AVI_LEVEL_UNKNOWN;
    }

    // NOTE typical string for wb:
    //    <tr>
    //    <td><span class="title2">Alpine</span></td>
    //    <td><img src="./file001_files/Low.jpg" alt="Sunday Alpine is Low" title="Sunday Alpine is Low"></td>
    //    <td><img src="./file001_files/Low.jpg" alt="Monday Alpine is Low" title="Monday Alpine is Low"></td>
    //    <td><img src="./file001_files/Considerable.jpg" alt="Tuesday Alpine is Considerable" title="Tuesday Alpine is Considerable"></td>
    //    </tr>

    var dangerRatingMatch = body.match(/<td>.*Alpine.*<\/td>\s*\n(\s*<td.*<\/td>\s*\n)(\s*<td.*<\/td>\s*\n)(\s*<td.*<\/td>\s*\n)/i);

    // the capture groups will be in slots 1, 2, 3
    if (dangerRatingMatch && dangerRatingMatch.length === 4) {
        for (var j = 0; j < aviLevels.length; j++) {
            aviLevels[j] = forecasts.findHighestAviLevelInString(dangerRatingMatch[j+1]);
        }
    } else {
        winston.warn('parse failure, danger levels not found; regionId: ' + regionDetails.regionId);
    }

    return aviLevels;
};

forecasts.parseForecast_ipac = function(body, regionDetails) {

    var forecast = null;

    var $ = cheerio.load(body, {lowerCaseTags:true, lowerCaseAttributeNames:true});

    var forecastIssuedDate = forecasts.parseForecastIssuedDate_ipac($, regionDetails);
    var aviLevels = forecasts.parseForecastValues_ipac($, regionDetails);

    // NOTE ipac currently issues forecasts morning of, for one day only
    if (forecastIssuedDate) {
        forecast = [];
        forecast[0] = {'date': moment(forecastIssuedDate).format('YYYY-MM-DD'), 'aviLevel': aviLevels[0]};

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseForecastIssuedDate_ipac = function($, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical html fragment for ipac: '<span class="date-text">02/15/2013</span>'
    var timestampTextBlock = $('span.date-text').first().text();

    if (timestampTextBlock.length > 0) {

        forecastIssuedDate = moment(timestampTextBlock, 'MM/DD/YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseForecastValues_ipac = function($) {

    // ipac forecasts one day at a time
    var aviLevels = [];
    aviLevels[0] = forecasts.AVI_LEVEL_UNKNOWN;

    // NOTE ipac danger ratings are in all caps
    // BUGBUG we need to find only text in in strong or bold, to avoid some false matches
    var forecastTextBlock = $('div#wsite-content').children().first().text();
    var allCapsMatches = forecastTextBlock.match(/[A-Z]{3,}/g);
    var allCapsText = (allCapsMatches ? allCapsMatches.join(' ') : '');
    aviLevels[0] = forecasts.findHighestAviLevelInString(allCapsText);

    return aviLevels;
};

forecasts.parseForecast_fac = function(body, regionDetails) {

    var forecast = null;
        
    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDateField = result.Advisory_data.Posted;
            // NOTE typical date string: '2014-12-11T06:35:27-0700'
            var forecastIssuedDate = moment.utc(forecastIssuedDateField, 'YYYY-MM-DD HH:mm:ss').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);
            var aviLevel = parseInt(result.Advisory_data.Danger_Rating);

            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_cnfaic = function(body, regionDetails) {

    var forecast = null;

    // NOTE cnfaic only does real forecasts for the turnagain region, not the summit region
    if (regionDetails.subregion === 'summit') {
        return null;
    }

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);

    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDateField = result.item[0]['dc:date'];
            // NOTE typical date string: '2013-03-16T10:00:00+01:00'
            var forecastIssuedDate = moment.utc(forecastIssuedDateField, 'YYYY-MM-DD').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            var ratingField = result.item[0].description;
            var aviLevel = forecasts.findHighestAviLevelInString(ratingField);

            // NOTE cnfaic issues single day forecasts
            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_jac = function(body, regionDetails) {

    var forecast = null;

    var $ = cheerio.load(body, {lowerCaseTags:true, lowerCaseAttributeNames:true});

    var forecastIssuedDate = forecasts.parseForecastIssuedDate_jac($, regionDetails);
    var aviLevels = forecasts.parseForecastValues_jac($);

    // NOTE jac currently issues forecasts morning of, for one day only, per Tom Mattice
    if (forecastIssuedDate) {
        forecast = [];
        forecast[0] = {'date': moment(forecastIssuedDate).format('YYYY-MM-DD'), 'aviLevel': aviLevels[0]};

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseForecastIssuedDate_jac = function($, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical html fragment for jac: '<h1 align="center">Current Advisory as of Friday, December 27, 2013</h1>'
    var headlines = $('h1').text();
    var timestampTextBlock = null;
    if (headlines) {
        var match = headlines.match(/Current Advisory as of\s+\w+,?\s+(\w+\s+\d+,?\s+\d+)/);
        if (match && match.length == 2) {
            timestampTextBlock = match[1];
        }
    }

    if (timestampTextBlock) {
        forecastIssuedDate = moment(timestampTextBlock, 'MMM DD, YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseForecastValues_jac = function($) {

    // jac forecasts one day at a time
    var aviLevels = [];
    aviLevels[0] = forecasts.AVI_LEVEL_UNKNOWN;

    // NOTE typical HTML fragment for jac: '<a href="dangerdef.php"><img src="http://www.juneau.org/avalanche/images/danger1.jpg" alt="Avalanche Danger Level 1" border="0"></a>'
    var forecastImageSource = $('img[src^="http://www.juneau.org/avalanche/images/danger"]').attr('src');
    if (forecastImageSource) {
        var forecastImageName = forecastImageSource.split('/').pop();
        if (forecastImageName) {
            var aviLevelNumberAsString = forecastImageName.split('.')[0].slice(-1);
            if (aviLevelNumberAsString) {
                var aviLevel = parseInt(aviLevelNumberAsString);
                if (aviLevel >= forecasts.AVI_LEVEL_UNKNOWN && aviLevel <= forecasts.AVI_LEVEL_EXTREME) {
                    aviLevels[0] = aviLevel;
                }
            }
        }        
    }

    return aviLevels;
};

forecasts.parseForecast_hg = function(body, regionDetails) {

    var forecast = null;

    var firstForecastedDate = forecasts.parseFirstForecastedDate_hg(body, regionDetails);
    var aviLevels = forecasts.parseForecastValues_hg(body, regionDetails);

    if (firstForecastedDate && aviLevels) {
        forecast = [];
        for (var i = 0; i < aviLevels.length; i++) {
            forecast[i] = {'date': moment(firstForecastedDate).clone().add(i, 'days').format('YYYY-MM-DD'), 'aviLevel': aviLevels[i]};
        }

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseFirstForecastedDate_hg = function(body, regionDetails) {

    var firstForecastedDate = null;

    // NOTE hg can issue forecasts the day before or the day of the first forecasted day; we need to correlate the
    // forecast issued date with the days of week that are described in the forecast
    var forecastIssuedDate = forecasts.parseForecastIssuedDate_hg(body, regionDetails);
    var firstForecastedDayOfWeek = forecasts.parseFirstForecastedDayOfWeek_hg(body, regionDetails);

    if (forecastIssuedDate && firstForecastedDayOfWeek) {

        var daysOfWeek = [];

        for (var i = 0; i < 2; i++) {
            // copy the value of the forecast issued date, offset by the appropriate number of days, and get the day of week
            daysOfWeek[i] = moment(forecastIssuedDate).clone().add(i, 'days');

            if (moment(daysOfWeek[i]).format('dddd').toLowerCase() === firstForecastedDayOfWeek.toLowerCase()) {
                firstForecastedDate = daysOfWeek[i];
                break;
            }
        }
    }

    return firstForecastedDate;
};

forecasts.parseForecastIssuedDate_hg = function(body, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical string for hg: 'Issued on :&nbsp;Thursday 30 January 2014 à 7:30'
    // or: 'Issued on&thinsp;:&nbsp;Friday December 12th 2014 at 7:30'
    var timestampMatch = body.match(/Issued\s+on\S+\s+(\w+\s+\w+\s+\d+)/i);

    // the capture group from the regex will be in slot 1 in the array
    if (timestampMatch && timestampMatch.length === 2) {

        forecastIssuedDate = moment(timestampMatch[1], 'MMM DD YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseFirstForecastedDayOfWeek_hg = function(body, regionDetails) {

    var firstForecastedDayOfWeek = null;

    // capture the first forecasted day of week
    // NOTE typical string for hg:
    //
    //    <tr>
    //        <th>Danger ratings</th>
    //        <th>Thursday</th>
    //        <th>Friday</th>
    //        <th>Outlook Saturday</th>
    //    </tr>
    var timestampMatch = body.match(/Danger\s+ratings<\/th>[^<]*<th>(\w+)<\/th>/i);

    // the capture group from the regex will be in slot 1 in the array
    if (timestampMatch && timestampMatch.length === 2) {
        firstForecastedDayOfWeek = timestampMatch[1];
        winston.verbose('found first forecasted day of week; regionId: ' + regionDetails.regionId + '; firstForecastedDayOfWeek: ' + firstForecastedDayOfWeek);
    } else {
        winston.warn('parse failure, first forecasted day of week not found; regionId: ' + regionDetails.regionId);
    }

    return firstForecastedDayOfWeek;
};

forecasts.parseForecastValues_hg = function(body, regionDetails) {

    // hg forecasts three days at a time
    var aviLevels = [];
    for (var i = 0; i < 3; i++) {
        aviLevels[i] = forecasts.AVI_LEVEL_UNKNOWN;
    }

    // NOTE typical string for hg:
    //
    //    <tr>
    //        <th>Alpine</th>
    //        <td class="risk-medium">Moderate</td><td class="risk-medium">Moderate</td><td class="risk-medium">Moderate</td>
    //    </tr>

    var dangerRatingMatch = body.match(/<th.*Alpine<\/th>[^<]*(<td[^<]*<\/td>)[^<]*(<td[^<]*<\/td>)[^<]*(<td[^<]*<\/td>)/i);

    // the capture groups will be in slots 1, 2, 3
    if (dangerRatingMatch && dangerRatingMatch.length === 4) {
        for (var j = 0; j < aviLevels.length; j++) {
            aviLevels[j] = forecasts.findHighestAviLevelInString(dangerRatingMatch[j+1]);
        }
    } else {
        winston.warn('parse failure, danger levels not found; regionId: ' + regionDetails.regionId);
    }

    return aviLevels;
};

forecasts.parseForecast_mwac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastDateField = result.channel.item.title;
            // NOTE typical date string: 'Avalanche Advisory for Sunday, February 16, 2014'
            var dateString = forecastDateField.match(/\w+\s+\w+\s*,?\s+\w+\s*$/i);
            var forecastIssuedDate = moment(dateString, 'MMM DD, YYYY').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            // NOTE parse the special rating html field out of the content field
            // typical special rating html field: <div id="rating">high</div>
            var contentField = result.channel.item['content:encoded'];
            var ratingMatch = contentField.match(/<div id=\"rating\">(\w+)<\/div>/i);

            // the capture groups from the regex will be in slot 1 in the array
            if (ratingMatch && ratingMatch.length === 2) {
                var aviLevelString = ratingMatch[1];
                var aviLevel = forecasts.findHighestAviLevelInString(aviLevelString);

                // NOTE mwac issues single day forecasts (although not every day)
                forecast = [];
                forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

                for (var j = 0; j < forecast.length; j++) {
                    winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
                }
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_msac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDateField = result.channel.item.pubDate;
            // NOTE typical date string: '03/08/2014 - 6:58am'
            var forecastIssuedDate = moment(forecastIssuedDateField, 'MM/DD/YYYY').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            // NOTE forecasts are valid for the day issued only
            var aviLevel = forecasts.findHighestAviLevelInString(result.channel.item.description);

            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_pac = function(body, regionDetails) {
    
    var forecast = null;

    var $ = cheerio.load(body, {lowerCaseTags:true, lowerCaseAttributeNames:true});

    var forecastIssuedDate = forecasts.parseForecastIssuedDate_pac($, regionDetails);
    var aviLevels = forecasts.parseForecastValues_pac($);

    // pac forecasts are single day, issued day of
    if (forecastIssuedDate) {
        forecast = [];
        forecast[0] = {'date': moment(forecastIssuedDate).format('YYYY-MM-DD'), 'aviLevel': aviLevels[0]};

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseForecastIssuedDate_pac = function($, regionDetails) {

    var forecastIssuedDate = null;
    
    // capture the forecast timestamp, by looking at the date after "Created:"
    // NOTE typical html fragment: '<p class="submitted"> Created:&nbsp;&nbsp; 12-22-2014 at 5:11 am<br /> </p>'
    var textBlock = $('[class="submitted"]').first().text();
    var dateText = null;
    if (textBlock) {
        var match = textBlock.match(/Created:\D*([0-9\-]+)/);
        if (match && match.length == 2) {
            dateText = match[1];
        }
    }

    if (dateText) {
        forecastIssuedDate = moment(dateText, 'MM-DD-YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseForecastValues_pac = function($) {

    // pac forecasts one day at a time
    var aviLevels = [];
    aviLevels[0] = forecasts.AVI_LEVEL_UNKNOWN;

    // for hazard level, look at image name (e.g., "ds-cons.gif" for considerable, etc.) within div id="bottomline"
    // NOTE typical HTML fragment: '<div id="bottomline" class="clearfix">  <h3>Bottom Line</h3> <img src="../i/ds-high.gif" class="img-responsive"> </div>'
    var forecastImageSource = $('div#bottomline > img').attr('src');
    if (forecastImageSource) {
        var forecastImageName = forecastImageSource.split('/').pop();
        if (forecastImageName) {
            var imageNameMap = {
                'ds-low.gif': 1,
                'ds-mod.gif': 2,
                'ds-cons.gif': 3,
                'ds-high.gif': 4,
                'ds-extr.gif': 5
            };
            var aviLevel = imageNameMap[forecastImageName];
            if (aviLevel) {
                aviLevels[0] = aviLevel;
            }
        }
    }

    return aviLevels;
};

forecasts.parseForecast_haic = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var regionNames = {
                1: 'Chilkat Pass',
                2: 'Transitional Zone',
                3: 'Lutak Zone'
            };
            var regionName = regionNames[regionDetails.subregion];
            var regionResults = underscore.find(result.Document.Placemark, function (item) {
                return (item.name === regionName);
            });
            var forecastExpiresDateField = underscore.find(regionResults.ExtendedData.Data, function (item) {
                return (item['@'].name === 'expdate');
            });
            
            // NOTE typical date string: '12/19/2014 11pm'
            var forecastIssuedDate = moment(forecastExpiresDateField.value, 'MM/DD/YYYY hha').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            // NOTE typical hazard string: '#3'
            var forecastHazardLevelString = regionResults.styleUrl.replace('#', '');
            var aviLevel = forecasts.findAviLevelNumberInString(forecastHazardLevelString);

            // NOTE forecasts are valid for the day issued only
            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch(e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};
