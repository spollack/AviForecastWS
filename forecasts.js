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
        if (regionId === 'cacb_north-rockies' ||
            regionId === 'cac2_1' ||
            regionId === 'hpac_1' ||
            regionId === 'kpac_1' ||
            regionId === 'uac_252' ||
            regionId === 'uac_259_1' ||
            regionId === 'uac_259_2' ||
            regionId === 'uac_259_3' ||
            regionId === 'uac_259_4' ||
            regionId === 'uac_259_5' ||
            regionId === 'aaic_183' ||
            regionId === 'aaic_189' ||
            regionId === 'aaic_197' ||
            regionId === 'aaic_193' ||
            regionId === 'aaic_186' ||
            regionId === 'aaic_194' ||
            regionId === 'aaic_191' ||
            regionId === 'gnfaic_281' ||
            regionId === 'cnfaic_282' ||
            regionId === 'cnfaic_121' ||
            regionId.split('_')[0] === 'jac' ||
            regionId.split('_')[0] === 'viac' ||
            regionId.split('_')[0] === 'hg') {
            winston.info('forecast validation: as expected, got null forecast; regionId: ' + regionId);
        } else {
            validForecast = false;
            winston.warn('forecast validation: UNEXPECTED got null forecast; regionId: ' + regionId);
        }

    } else if (!forecast.length) {
        validForecast = false;
        winston.warn('forecast validation: UNEXPECTED got empty forecast; regionId: ' + regionId);

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
            if (!(forecast[i].aviLevel >= forecasts.AVI_LEVEL_UNKNOWN && forecast[i].aviLevel <= forecasts.AVI_LEVEL_EXTREME)) {
                winston.warn('forecast validation: UNEXPECTED BUG!!! got invalid aviLevel in forecast; regionId: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
                break;
            }
        }

        // aviLevel should not be AVI_LEVEL_UNKNOWN
        for (i = 0; i < forecast.length; i++) {
            if (forecast[i].aviLevel === forecasts.AVI_LEVEL_UNKNOWN) {
                // NOTE known exceptions: certain regions always/sometimes posts forecasts with a valid issued date but
                // without danger level ratings
                if (regionId === 'caic_9') {
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
        var timezoneOffsetMinutes = moment().utcOffset();
        var pstOffsetMinutes = 8 * 60;
        var currentPSTDate = moment().subtract(timezoneOffsetMinutes, 'minutes').subtract(pstOffsetMinutes, 'minutes').format('YYYY-MM-DD');
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
            if (regionId === 'wcmac_north' || regionId === 'wcmac_central' || regionId === 'wcmac_south') {
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
                    } catch (e) {
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
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/NWAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'cac':
                    // CAC South Coast has two polygons that have the same forecast; handle that
                    var subRegion = components[1].split('_')[0];
                    dataURL = 'https://www.avalanche.ca/api/forecasts/' + subRegion + '.json';
                    parser = forecasts.parseForecast_cac;
                    break;
                case 'cacb': // CAC blog-only forecasts, which we don't parse
                    dataURL = 'https://www.avalanche.ca/blogs?category=' + components[1];
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'pc':
                    dataURL = 'https://avalanche.pc.gc.ca/CAAML-eng.aspx?d=TODAY&r=' + components[1];
                    parser = forecasts.parseForecast_pc;
                    break;
                case 'caic':
                    // NOTE look up the data url (because of the more complex mapping)
                    dataURL = forecasts.getDataURL_caic(components[1]);
                    parser = forecasts.parseForecast_simple_caaml;
                    break;
                case 'viac':
                    dataURL = 'https://www.islandavalanchebulletin.com/';
                    // NOTE parser is temporarily disabled
                    //parser = forecasts.parseForecast_viac;
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'sac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/SAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'esac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/ESAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'pac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/PAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'btac':
                    dataURL = 'https://www.jhavalanche.org/media/xml/' + components[1] + '_Avalanche_Forecast.xml';
                    parser = forecasts.parseForecast_simple_caaml;
                    break;
                case 'wcmac':
                    dataURL = 'https://www.missoulaavalanche.org/advisories/feed/';
                    parser = forecasts.parseForecast_wcmac;
                    break;
                case 'snfac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/SNFAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'ipac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/IPAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'fac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/FAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'cnfaic':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/CNFAIC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'jac':
                    dataURL = 'https://beta.juneau.org/emergency/current-advisory';
                    // NOTE parser is temporarily disabled
                    //parser = forecasts.parseForecast_jac;
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'cac2':
                    dataURL = 'https://www.cityofcordova.net/residents/a-safe-cordova/avalanche-conditions';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'hpac':
                    dataURL = 'http://hatcherpassavalanchecenter.org/';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'kpac':
                    dataURL = 'https://kachinapeaks.org/snowpack';
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'wac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/WAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'hg':
                    dataURL = 'https://avalanchequebec.ca/conditions-chic-chocs#bulletins-avalanche';
                    // NOTE parser is temporarily disabled
                    //parser = forecasts.parseForecast_hg;
                    parser = forecasts.parseForecast_noop;
                    break;
                case 'msac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/MSAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'aaic':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/AAIC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'uac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/UAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'bac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/BAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'coaa':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/COAA';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'gnfac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/GNFAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'tac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/TAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'mwac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/MWAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
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
    var baseURL = 'https://avalanche.state.co.us/media/xml/';

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

    try {

        var bodyJson = JSON.parse(body);

        // NOTE create an extra slot for the day before the first described day, as sometimes the forecast is issued
        // with the first described day as the following day; we want to show some forecast for the time until
        // the following day kicks in, so we assume in this case the the danger level for the first described day
        // is also applicable to the time between when the forecast is issued and the first described day
        forecast = [];

        for (var i = 0; i < bodyJson.dangerRatings.length; i++) {

            var date = moment.utc(bodyJson.dangerRatings[i].date).format('YYYY-MM-DD');

            // NOTE cac organizes forecasts by multiple elevation zones within a given day;
            // take the highest danger level listed for each day
            // NOTE not all 3 fields (Alp/Tln/Btl) are necessarily present
            var aviLevel = Math.max(
                forecasts.findHighestAviLevelInString(bodyJson.dangerRatings[i].dangerRating.alp),
                forecasts.findHighestAviLevelInString(bodyJson.dangerRatings[i].dangerRating.tln),
                forecasts.findHighestAviLevelInString(bodyJson.dangerRatings[i].dangerRating.btl));

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
    } catch (e) {
        winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        forecast = null;
    }

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
        } catch (e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_avalanche_org_api = function(body, regionDetails) {

    var forecast = null;

    try {
        // convert the JSON response to an object
        var bodyJson = JSON.parse(body);

        // NOTE avalanche.org api region ids are not guaranteed stable over time...
        var avalancheOrgApiRegionId = +(regionDetails.regionId.split('_')[1]);

        var regionForecastData = underscore.findWhere(bodyJson.features, {id: avalancheOrgApiRegionId});

        // NOTE the API can have null values for the dates, which means no rating available
        if (regionForecastData.properties.start_date && regionForecastData.properties.end_date) {

            // NOTE only parse the dates, ingore times for now
            var forecastValidTimeStart = moment(regionForecastData.properties.start_date, 'MM/DD');
            var forecastValidTimeEnd = moment(regionForecastData.properties.end_date, 'MM/DD');

            var daysValid = moment(forecastValidTimeEnd).diff(moment(forecastValidTimeStart), 'days') + 1;

            var aviLevel = forecasts.findAviLevelNumberInString(regionForecastData.properties.rating);

            forecast = [];
            for (var i = 0; i < daysValid; i++) {
                forecast[i] = {'date': moment(forecastValidTimeStart).clone().add(i, 'days').format('YYYY-MM-DD'), 'aviLevel': aviLevel};
            }

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        }
    } catch (e) {
        winston.warn('failure parsing avalanche.org api forecast; error: ' + JSON.stringify(e));
    }

    return forecast;
};

forecasts.parseForecast_simple_caaml = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastValidTimeStart = forecasts.dateStringFromDateTimeString_caaml(result.validTime.TimePeriod.beginPosition);
            var forecastValidTimeEnd = forecasts.dateStringFromDateTimeString_caaml(result.validTime.TimePeriod.endPosition);

            // NOTE these sites typically issue avalanche forecasts for one day at a time; however, if a longer time
            // range is specified, follow that
            // moment#diff will truncate the result to zero decimal places, returning an integer, so we are being
            // conservative on forecast duration
            var daysValid = Math.max(moment(forecastValidTimeEnd).diff(moment(forecastValidTimeStart), 'days'), 1);

            var aviLevel = forecasts.findAviLevelNumberInString(result.bulletinResultsOf.BulletinMeasurements.dangerRatings.DangerRatingSingle.mainValue);

            forecast = [];
            for (var i = 0; i < daysValid; i++) {
                forecast[i] = {'date': moment(forecastValidTimeStart).clone().add(i, 'days').format('YYYY-MM-DD'), 'aviLevel': aviLevel};
            }

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch (e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.dateStringFromDateTimeString_caaml = function(dateTimeString) {
    // NOTE typical date string: '2012-02-02T18:14:00' or '2012-02-10T00:00:00Z'
    return dateTimeString.slice(0,10);
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
    // NOTE typical string: '<h2>Wednesday February 19, 2020</h2>'
    var timestampMatch = body.match(/(January?|February?|March?|April?|May|June?|July?|August?|September?|October?|November?|December?)\s+\d{1,2},\s+\d{4}\<\/h2\>/i);

    // the capture groups from the regex will be in slots 0 and 1 in the array
    if (timestampMatch && timestampMatch.length === 2) {

        forecastIssuedDate = moment(timestampMatch[0], 'MMM DD YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseFirstForecastedDayOfWeek_viac = function(body, regionDetails) {

    var firstForecastedDayOfWeek = null;

    // capture the first forecasted day of week
    // NOTE typical string for viac: '<h2>Wednesday February 19, 2020</h2>'
    var timestampMatch = body.match(/\<h2\>(Monday?|Tuesday?|Wednesday?|Thursday?|Friday|Saturday?|Sunday?)\s+(January?|February?|March?|April?|May|June?|July?|August?|September?|October?|November?|December?)\s+\d{1,2},\s+\d{4}\<\/h2\>/i);

    // the capture groups from the regex will be in slot 1 in the array
    if (timestampMatch && timestampMatch.length === 3) {
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
    //<h2>Wednesday February 19, 2020</h2>
    //  <div class="danger-ratings columns">
    //    <div class="column">
    //      <danger-rating :alpine="2" :treeline="1" :below="1">Wednesday February 19, 2020</danger-rating>
    //    </div>
    //    <div class="column">
    //      <danger-rating :alpine="2" :treeline="1" :below="1">Thursday February 20, 2020</danger-rating>
    //    </div>
    //    <div class="column">
    //      <danger-rating :alpine="2" :treeline="1" :below="1">Friday February 21, 2020</danger-rating>
    //    </div>
    //  </div>

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
        } catch (e) {
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
        } catch (e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_pac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {

            var forecastIssuedDateField = result.Advisory_data.Posted;
            // NOTE typical date string: '2014-12-11T06:35:27-0700'
            var forecastIssuedDate = moment.utc(forecastIssuedDateField, 'YYYY-MM-DD HH:mm:ss').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            // TODO check and leverage "Until" date too from forecast xml to see how many days the forecast should be valid for

            var aviLevel = forecasts.findAviLevelNumberInString(result.Advisory_data.Danger_Rating);
            // NOTE pac issues single day forecasts
            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch (e) {
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
        } catch (e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};

forecasts.parseForecast_ipac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDateField = result.Advisory_data.Posted;
            // NOTE typical date string: '2014-12-11T06:35:27-0700'
            var forecastIssuedDate = moment.utc(forecastIssuedDateField, 'YYYY-MM-DD HH:mm:ss').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            // TODO check and leverage "Until" date too from forecast xml to see how many days the forecast should be valid for

            var aviLevel = forecasts.findAviLevelNumberInString(result.Advisory_data.Danger_Rating);

            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch (e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
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

            // TODO check and leverage "Until" date too from forecast xml to see how many days the forecast should be valid for

            var aviLevel = forecasts.findAviLevelNumberInString(result.Advisory_data.Danger_Rating);

            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch (e) {
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
    // NOTE typical html fragment for jac: '<div id="gv_diy_59234" class="gv-diy-view"><div class="gv-field-102-date_created">February 14, 2020</div></div>'
    var headlines = $('#gv_diy_59234 div.gv-field-102-date_created').text();
    var timestampTextBlock = null;
    if (headlines) {
        var match = headlines.match(/(January?|February?|March?|April?|May|June?|July?|August?|September?|October?|November?|December?)\s+\d{1,2},\s+\d{4}/);
        if (match && match.length == 2) {
            timestampTextBlock = match[0];
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

    // NOTE typical HTML fragment for jac: '<img src="https://3tb2gc2mxpvu3uwt0l20tbhq-wpengine.netdna-ssl.com/wp-content/uploads/2018/12/danger2.jpg" alt="Danger Level: 2 - Moderate">'
    var forecastImageSource = $('img[src^="https://3tb2gc2mxpvu3uwt0l20tbhq-wpengine.netdna-ssl.com/wp-content/uploads/2018/12/danger"]').attr('src');
    if (forecastImageSource) {
        var forecastImageName = forecastImageSource.split('/').pop();
        if (forecastImageName) {
            var aviLevelNumberAsString = forecastImageName.split('.')[0].slice(-1);
            if (aviLevelNumberAsString) {
                aviLevels[0] = forecasts.findAviLevelNumberInString(aviLevelNumberAsString);
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
    // NOTE typical string for hg:
    // Issued on: 2020-02-20 @ 00:00
    // Diffusé le : 2020-02-20 @ 00:00
    // Regex for full timestamp including time: /Issued\s+on\S+\s+(\d+\-\d+\-\d+\s@\s\d+\:\d+)/
    var timestampMatch = body.match(/Issued\s+on\S+\s+(\d+\-\d+\-\d+)/i);

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
    //<thead>
  	//	<tr>
  	//		<td style="width: 40%;">Danger ratings</td>
  	//		<td style="width: 20%;">Thursday</td>
  	//		<td style="width: 20%;">Friday</td>
  	//		<td style="width: 20%;">Saturday</td>
  	//	</tr>
  	//</thead>
    var timestampMatch = body.match(/<td[^>]*>Danger\sratings<\/td>\s*<td[^>]*>\s*(\w+)[^<]*<\/td>/i);

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
    // <tbody>
    //		<tr>
    //			<td>Alpine</td>
    //			<td class="risk-significant">Considerable</td>
    //			<td class="risk-significant">Considerable</td>
    //			<td class="risk-significant">Considerable</td>
    //		</tr>

    var dangerRatingMatch = body.match(/<td.*Alpine<\/td>[^<]*(<td[^<]*<\/td>)[^<]*(<td[^<]*<\/td>)[^<]*(<td[^<]*<\/td>)/i);

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

forecasts.parseForecast_msac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {

            var forecastIssuedDateField = result.Advisory_data.Posted;
            // NOTE typical date string: '2014-12-11T06:35:27-0700'
            var forecastIssuedDate = moment.utc(forecastIssuedDateField, 'YYYY-MM-DD HH:mm:ss').format('YYYY-MM-DD');
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + forecastIssuedDate);

            // NOTE forecasts are valid for the day issued only
            var aviLevel = forecasts.findAviLevelNumberInString(result.Advisory_data.Danger_Rating);

            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};

            for (var j = 0; j < forecast.length; j++) {
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        } catch (e) {
            winston.warn('parse failure; regionId: ' + regionDetails.regionId + '; exception: ' + e);
        }
    });

    return forecast;
};
