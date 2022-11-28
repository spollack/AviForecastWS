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


forecasts.aggregateForecasts = function(regions = []) {
    winston.info('aggregateForecasts: initiated');
    if (regions.length === 0) {
        regions = JSON.parse(fs.readFileSync(forecasts.REGIONS_PATH, 'utf8'));
    }
    var startTime = new Date();
    var forecastsArray = [];
    var invalidCount = 0;

    async.forEachLimit(
        regions,
        forecasts.DATA_REQUESTS_IN_PARALLEL,
        function(region, callback) {
            var regionId = region.regionId;
            forecasts.forecastForRegion(region, function(forecast) {

                // sanity check the forecast
                var valid = forecasts.validateForecast(region, forecast, true);
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

forecasts.validateForecast = function(region, forecast, validateForCurrentDay) {

    // BUGBUG how do we deal with centers shutting down for the season???

    var validForecast = true;
    var regionId = region.regionId;
    var centerId = region.centerId;
    if (!forecast) {
        // check for null forecast

        // NOTE known exceptions: these regions currently do not provide any danger level ratings
        if (regionId === 'nac_187' ||
            regionId === 'nac_190' ||
            regionId === 'nac_202' ||
            regionId === 'nac_252' ||
            regionId === 'nac_259_1' ||
            regionId === 'nac_259_2' ||
            regionId === 'nac_259_3' ||
            regionId === 'nac_259_4' ||
            regionId === 'nac_259_5' ||
            regionId === 'nac_183' ||
            regionId === 'nac_189' ||
            regionId === 'nac_197' ||
            regionId === 'nac_193' ||
            regionId === 'nac_186' ||
            regionId === 'nac_194' ||
            regionId === 'nac_191' ||
            regionId === 'nac_121' ||
            regionId === 'nac_203' ||
            regionId === 'nac_282' ||
            regionId === 'nac_261' ||
            centerId === 'caac' ||
            centerId === 'juak' ||
            centerId === 'wcmac' ||
            centerId === 'avalanche-quebec') {
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
                if (regionId === 'nac_60' ||
                    regionId === 'ca_kananaskis' ||
                    regionId === 'ca_long-range-mountains' ||
                    centerId === 'wac' ||
                    centerId === 'ipac') {
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
            validForecast = forecasts.validateForecastForCurrentDay(region, forecast);
        }
    }

    return validForecast;
};

forecasts.validateForecastForCurrentDay = function(region, forecast) {

    var regionId = region.regionId;
    var centerId = region.centerId;

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
            if (regionId === 'ca_long-range-mountains' || centerId === 'wcmac') {
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

forecasts.forecastForRegion = function(region, onForecast) {

    var regionDetails = forecasts.getRegionDetailsForRegion(region);
    var forecast = null;
    var regionId = region.regiondId;

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

forecasts.getRegionDetailsForRegion = function(region) {

    var regionDetails = null;
    var regionId = region.regionId;
    var centerId = region.centerId;
    if (centerId) {
        // NOTE split the regionId at the first underscore, into two pieces
        var index = regionId.indexOf('_');
        if (index !== -1) {
            var components = [regionId.slice(0, index), regionId.slice(index + 1)];
            // NOTE the URLs used here by the server for pull data may be different than the URLs for users viewing the
            // corresponding forecast as a web page
            var dataURL = null;
            var parser = null;
            switch (centerId) {
                case 'avalanche-quebec':
                case 'kananaskis':
                case 'viac':
                case 'avalanche-canada':
                    // CAC South Coast has two polygons that have the same forecast; handle that
                    var subRegion = components[1].split('_')[0];
                    dataURL = 'https://www.avalanche.ca/api/forecasts/' + subRegion + '.json';
                    parser = forecasts.parseForecast_cac;
                    break;
                case 'parks-canada':
                    dataURL = forecasts.getDataURL_pc(components[1])
                    parser = forecasts.parseForecast_pc;
                    break;
                case 'nwac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/NWAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'caic':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/CAIC';
                    parser = forecasts.parseForecast_avalanche_org_api;
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
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/BTAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'wcmac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/WCMAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
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
                case 'juak':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/JUAK';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'caac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/CAAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'ctcak':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/CTCAK';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'hpac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/HPAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'kpac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/KPAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
                    break;
                case 'wac':
                    dataURL = 'https://api.avalanche.org/v1/forecast/get-map-data/WAC';
                    parser = forecasts.parseForecast_avalanche_org_api;
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
                regionDetails = {'regionId': regionId, 'provider': centerId, 'subregion': components[1], 'dataURL': dataURL, 'parser': parser};
                winston.verbose('regionDetails: ' + JSON.stringify(regionDetails));
            }
        }
    }

    return regionDetails;
};

forecasts.getDataURL_pc = function(subregion) {
    var dataURL = null;
    var baseURL = 'https://avalanche.pc.gc.ca/CAAML-eng.aspx?d=TODAY&r=';
    switch (subregion) {
        case 'banff':
            dataURL = baseURL + '1';
            break;
        case 'jasper':
            dataURL = baseURL + '2';
            break;
        case 'glacier':
            dataURL = baseURL + '3';
            break;
        case 'waterton':
            dataURL = baseURL + '4';
            break;
        case 'littleYoho':
            dataURL = baseURL + '5';
            break;
        default:
            winston.warn('getDataURL_pc: no match for subregion: ' + subregion);
            break;
    }
    return dataURL;
}

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
            var endDate = moment.utc(bodyJson.dangerRatings[i].date).format('YYYY-MM-DD');
            var startDate = moment(endDate, 'YYYY-MM-DD').subtract(1, 'days');
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
                var dayBeforeFirstDate = moment(startDate, 'YYYY-MM-DD').subtract(1, 'days');
                forecast[0] = {'date': moment(dayBeforeFirstDate).format('YYYY-MM-DD'), 'aviLevel': aviLevel};
            }

            // put this described day in the array, shifted by one position
            forecast[i+1] = {'date': startDate, 'aviLevel': aviLevel};
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


            forecast = [];
            const forecastsByDay = {};

            for (const dayForecast of dayForecasts) {
                const timePosition = dayForecast.validTime.TimeInstant.timePosition;
                const date = forecasts.dateStringFromDateTimeString_caaml(timePosition);
                if (!(date in forecastsByDay)) {
                    forecastsByDay[date] = [];
                }
                let aviLevel = dayForecast.mainValue;
                if (aviLevel == 'N/A') {
                  aviLevel = 0;
                } else {
                  aviLevel = parseInt(aviLevel);
                }
                forecastsByDay[date].push(aviLevel);
            }
            for (const [date, aviLevels] of Object.entries(forecastsByDay)) {
                forecast.push({date: date, aviLevel: Math.max(...aviLevels)});
            }
             // NOTE create an extra slot for the day before the first described day, as sometimes the forecast is issued
            // with the first described day as the following day; we want to show some forecast for the time until
            // the following day kicks in, so we assume in this case the the danger level for the first described day
            // is also applicable to the time between when the forecast is issued and the first described day;
            forecast.sort((l, r) => { return l.date.localeCompare(r.date); });
            const previousDay = moment(forecast[0].date).subtract(1, 'days').format('YYYY-MM-DD');
            forecast.unshift({date: previousDay, aviLevel: forecast[0].aviLevel});

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

            // NOTE only parse the dates, ignore times for now
            var forecastValidTimeStart = moment(regionForecastData.properties.start_date, 'YYYY-MM-DD');
            var forecastValidTimeEnd = moment(regionForecastData.properties.end_date, 'YYYY-MM-DD');

            var daysValid = moment(forecastValidTimeEnd).diff(moment(forecastValidTimeStart), 'days') + 1;

            var aviLevel = forecasts.findAviLevelNumberInString(regionForecastData.properties.danger_level);

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

forecasts.dateStringFromDateTimeString_caaml = function(dateTimeString) {
    // NOTE typical date string: '2012-02-02T18:14:00' or '2012-02-10T00:00:00Z'
    return dateTimeString.slice(0,10);
};