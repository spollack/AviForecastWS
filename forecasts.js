//
// Copyright (c) 2012-2013 Sebnarware. All rights reserved.
//


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
var _ = require('underscore');
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
        if (regionId === 'cac_bighorn' || regionId === 'cac_north-rockies' || regionId === 'cnfaic_summit') {
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

            var expectedDate = moment(firstDate, 'YYYY-MM-DD').add('days', i).format('YYYY-MM-DD');
            if (expectedDate !== forecast[i].date) {
                validForecast = false;
                winston.warn('forecast validation: UNEXPECTED date for regionId: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
                break;
            }
        }

        // aviLevel should not be AVI_LEVEL_UNKNOWN
        for (i = 0; i < forecast.length; i++) {
            if (forecast[i].aviLevel === forecasts.AVI_LEVEL_UNKNOWN) {
                // NOTE known exceptions: certain regions always/sometimes posts forecasts with a valid issued date but 
                // without danger level ratings
                if (regionId === 'caic_090' || regionId === 'caic_091'|| regionId === 'uac_skyline' || regionId === 'uac_moab_1' || regionId === 'uac_moab_2' || regionId ==='snfac_4') {
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
        var currentPSTDate = moment().add('minutes', timezoneOffsetMinutes).subtract('minutes', pstOffsetMinutes).format('YYYY-MM-DD');
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
                || regionId === 'wcmac_north' || regionId === 'wcmac_south' || regionId === 'esac_north' || regionId === 'esac_south' || regionId === 'esac_mammoth'
                || regionId === 'ipac_1' || regionId === 'ipac_2' || regionId === 'ipac_3' || regionId === 'ipac_4') {
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
                if (!error && response.statusCode === 200) {
                    winston.info('successful dataURL response; regionId: ' + regionDetails.regionId +
                        '; dataURL: ' + regionDetails.dataURL);
                    forecast = regionDetails.parser(body, regionDetails);
                    
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
                    dataURL = 'http://www.nwac.us/api/v1/currentForecast/' + components[1] + '/';
                    parser = forecasts.parseForecast_nwac;
                    break;
                case 'cac':
                    dataURL = 'http://www.avalanche.ca/dataservices/cac/bulletins/xml/' + components[1];
                    parser = forecasts.parseForecast_cac;
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
                    
                    // BUGBUG for sandbox testing
//                    dataURL = 'http://sandbox.utahavalanchecenter.org/advisory/' + subregion + '/json';
                    
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
                case 'btac':
                    dataURL = 'http://www.jhavalanche.org/media/xml/' + components[1] + '_Avalanche_Forecast.xml';
                    parser = forecasts.parseForecast_simple_caaml;
                    break;
                case 'gnfac':
                    dataURL = 'http://www.mtavalanche.com/sites/default/files/xml/' + components[1] + '_Forecast.xml';
                    parser = forecasts.parseForecast_simple_caaml;
                    break;
                case 'esac':
                    dataURL = 'http://esavalanche.org/advisory';
                    parser = forecasts.parseForecast_esac;
                    break;
                case 'wcmac':
                    dataURL = 'http://www.missoulaavalanche.org/feed/';
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
                case 'cnfaic':
                    dataURL = 'http://www.cnfaic.org/library/rssfeed_map.php';
                    parser = forecasts.parseForecast_cnfaic;
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
        case '000':
        case '001':
        case '002':
        case '003':
            dataURL = baseURL + 'Steamboat_and_Flat_Tops_Avalanche_Forecast.xml';
            break;
        case '010':
        case '012':
        case '013':
        case '014':
        case '015':
            dataURL = baseURL + 'Front_Range_Avalanche_Forecast.xml';
            break;
        case '020':
            dataURL = baseURL + 'Vail_and_Summit_County_Avalanche_Forecast.xml';
            break;
        case '030':
            dataURL = baseURL + 'Sawatch_Range_Avalanche_Forecast.xml';
            break;
        case '040':
        case '042':
            dataURL = baseURL + 'Aspen_Avalanche_Forecast.xml';
            break;
        case '050':
            dataURL = baseURL + 'Gunnison_Avalanche_Forecast.xml';
            break;
        case '060':
        case '061':
            dataURL = baseURL + 'Grand_Mesa_Avalanche_Forecast.xml';
            break;
        case '070':
            dataURL = baseURL + 'Northern_San_Juan_Avalanche_Forecast.xml';
            break;
        case '080':
            dataURL = baseURL + 'Southern_San_Juan_Avalanche_Forecast.xml';
            break;
        case '090':
        case '091':
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

forecasts.parseForecast_nwac = function(body, regionDetails) {

    var forecast = null;

    try {
        // convert the JSON response to an object
        var bodyJson = JSON.parse(body);

        // nwac forecasts go 2 days out; typically they are issued the evening before, for the following two days, 
        // although sometimes they are issued the same day

        var NUM_FORECAST_DAYS_NWAC = 2;

        forecast = [];
        for (var i = 0; i < NUM_FORECAST_DAYS_NWAC; i++) {
            // NOTE one-based index
            var forecastIndex = i + 1;
            var forecastTimestampLabel = 'forecast_day' + forecastIndex + '_timestamp';
            var forecastDate = moment(bodyJson[forecastTimestampLabel], 'YYYY-MM-DD HH-mm-ss').format('YYYY-MM-DD');
            var aviLevel = forecasts.getAviLevelForForecastDayIndex_nwac(bodyJson, regionDetails, forecastIndex);
            forecast[i] = {'date':forecastDate, 'aviLevel':aviLevel};
        }

        // if the forecast was issued the day before the first forecast day, copy the forecast from that 
        // first forecast day into the forecast issued day too
        var forecastIssuedDate = moment(bodyJson.published_date, 'YYYY-MM-DD HH-mm-ss');
        var dayAfterForecastIssuedDate = moment(forecastIssuedDate).clone().add('days', 1).format('YYYY-MM-DD');
        if (dayAfterForecastIssuedDate === forecast[0].date) {
            // create an entry at the front of the forecast array for the forecast issued date, with the aviLevel of the following day
            var issuedDateForecast = {'date':moment(forecastIssuedDate).format('YYYY-MM-DD'), 'aviLevel':forecast[0].aviLevel};
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

    var aviLevel = forecasts.AVI_LEVEL_UNKNOWN;

    if (bodyJson.danger_roses) {

        // find the appropriate forecast data
        var dangerRoseData = null;
        for (var i = 0; i < bodyJson.danger_roses.length; i++) {
            if (bodyJson.danger_roses[i].day_number === forecastIndex) {
                dangerRoseData = bodyJson.danger_roses[i];
                break;
            }
        }

        if (dangerRoseData) {
            // strip out unwanted fields, to leave just the danger level fields
            var filteredDangerRoseData = _.omit(dangerRoseData, 'day_number',  'trend', 'warning', 'preview');

            // get the highest danger level from the danger rose
            var dangerLevels = _.map(filteredDangerRoseData, function(value) {
                return forecasts.findHighestAviLevelInString(value);
            });
            aviLevel = _.max(dangerLevels);
        }
    }

    return aviLevel;
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
                    var dayBeforeFirstDate = moment(date, 'YYYY-MM-DD').subtract('days', 1);
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
                    var dayBeforeFirstDate = moment(date, 'YYYY-MM-DD').subtract('days', 1);
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
            var forecastDate = moment.unix(bodyJson.advisories[0].advisory.date_issued_timestamp).utc().subtract('hours', mstOffsetHours).format('YYYY-MM-DD');
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
            forecast[i] = {'date': moment(firstForecastedDate).clone().add('days', i).format('YYYY-MM-DD'), 'aviLevel': aviLevels[i]};
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
            daysOfWeek[i] = moment(forecastIssuedDate).clone().add('days', i);

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
    // NOTE typical string for viac: 'Date Issued </span>February 24, 2012 at 11:19AM</div>'
    var timestampMatch = body.match(/Date Issued\s*<\/span>\s*(\w+\s+\d+)\w*\s*,?\s*(\d+)/i);

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
            // NOTE typical date string: 'Sun. November 18, 2012'
            var forecastIssuedDate = moment(forecastIssuedDateField, 'ddd. MMM DD YYYY').format('YYYY-MM-DD');
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

    var $ = cheerio.load(body, {lowerCaseTags:true, lowerCaseAttributeNames:true});

    var forecastIssuedDate = forecasts.parseForecastIssuedDate_esac($, regionDetails);
    var aviLevels = forecasts.parseForecastValues_esac($, regionDetails);

    // NOTE per request of Nate Greenberg (2013-01-01), make all esac forecasts valid for two days, unless replaced by a newer one
    if (forecastIssuedDate) {
        forecast = [];
        forecast[0] = {'date': moment(forecastIssuedDate).format('YYYY-MM-DD'), 'aviLevel': aviLevels[0]};
        forecast[1] = {'date': moment(forecastIssuedDate).clone().add('days', 1).format('YYYY-MM-DD'), 'aviLevel': aviLevels[0]};

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseForecastIssuedDate_esac = function($, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical html fragment for esac: '<span class="month">Feb</span> <span class="day">10</span> <span class="year">2013</span>'
    var timestampString = [$('span.month').text(), $('span.day').text(), $('span.year').text()].join(' ').trim();
    if (timestampString.length > 0) {
        forecastIssuedDate = moment(timestampString, 'MMM DD YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseForecastValues_esac = function($, regionDetails) {

    // esac forecasts one days at a time
    var aviLevels = [];
    aviLevels[0] = forecasts.AVI_LEVEL_UNKNOWN;

    // NOTE esac forecasts show the bottom line based on an image bar that is specific to one of the 5 danger levels, so
    // go grab that img tag and look at the source link to get the danger level
    // typical example:
    // <img class="avyrating_large" src="./file006_files/1.png" height="60" width="640">
    // NOTE parsing the highest danger level from the text description doesn't always give the same result
    var forecastAdvisoryImgTag = $('img.avyrating_large');
    var srcPath = (forecastAdvisoryImgTag && forecastAdvisoryImgTag.length > 0 ? forecastAdvisoryImgTag[0].attribs.src : '');
    var lastPathElement = srcPath.split('/').pop();
    var suffixString = '.png';
    var dangerLevel = parseInt(lastPathElement.slice(0, - suffixString.length));
    
    aviLevels[0] = dangerLevel;

    return aviLevels;
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
            var forecastIssuedDate = moment.utc(forecastIssuedDateField, 'ddd, DD MMM YYYY HH:mm:ss Z').subtract('hours', mstOffsetHours).format('YYYY-MM-DD');
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
            forecast[i] = {'date': moment(firstForecastedDate).clone().add('days', i).format('YYYY-MM-DD'), 'aviLevel': aviLevels[i]};
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
            daysOfWeek[i] = moment(forecastIssuedDate).clone().add('days', i);

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

forecasts.parseForecastValues_ipac = function($, regionDetails) {

    // ipac forecasts one days at a time
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

forecasts.parseForecast_cnfaic = function(body, regionDetails) {

    // NOTE cnfaic only does real forecasts for the turnagain region, not the summit region
    if (regionDetails.subregion === 'summit') {
        return null;
    }

    var forecast = null;

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





