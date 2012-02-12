//
// Copyright (c) 2012 Sebnarware. All rights reserved.
//


//
// required packages
//

var winston = require('winston');
var request = require('request');
var moment = require('moment');
var xml2js = require('xml2js');
var fs = require('fs');


//
// constants
//

// avi danger levels
var AVI_LEVEL_UNKNOWN = 0;
var AVI_LEVEL_LOW = 1;
var AVI_LEVEL_MODERATE = 2;
var AVI_LEVEL_CONSIDERABLE = 3;
var AVI_LEVEL_HIGH = 4;
var AVI_LEVEL_EXTREME = 5;

// time intervals
// NOTE to ensure forecasts get generated, ensure FORECAST_GEN_INTERVAL_SECONDS >> DATA_REQUEST_TIMEOUT_SECONDS
// NOTE the total delay that a client might see from forecast issued to available at client is the sum
// of FORECAST_GEN_INTERVAL_SECONDS + CACHE_MAX_AGE_SECONDS
var DATA_REQUEST_TIMEOUT_SECONDS = 15;
var FORECAST_GEN_INTERVAL_SECONDS = exports.FORECAST_GEN_INTERVAL_SECONDS = 60;
var CACHE_MAX_AGE_SECONDS = exports.CACHE_MAX_AGE_SECONDS = 60;

// filepaths
var STATIC_FILES_DIR_PATH = exports.STATIC_FILES_DIR_PATH  = __dirname + '/public';
var REGIONS_PATH = exports.REGIONS_PATH = __dirname + '/public/v1/regions.json';
var FORECASTS_DATA_PATH = __dirname + '/public/v1/forecasts.json';
var FORECASTS_DATA_TEMP_PATH = __dirname + '/public/v1/forecasts_TEMP.json';


//
// forecast content generation
//

exports.aggregateForecasts = aggregateForecasts;
function aggregateForecasts(regions) {
    winston.info('aggregateForecasts: initiated');

    var forecastsRemainingCount = regions.length;
    var forecasts = [];

    for (var i = 0; i < regions.length; i++) {

        var regionId = regions[i].regionId;
        winston.verbose('generating forecast for regionId: ' + regionId);

        forecastForRegionId(regionId,
            function(regionId, forecast) {

                // add the forecast to the forecasts array
                // NOTE the order of completion is not deterministic, so they may end up in any order in the array
                forecasts.push({'regionId':regionId, 'forecast':forecast});

                forecastsRemainingCount--;
                if (forecastsRemainingCount === 0) {
                    winston.info('aggregateForecasts: all forecasts processed, region count: ' + regions.length);
                    winston.verbose(JSON.stringify(forecasts, null, 4));

                    // write the forecasts out to a static json file, that can be served by the HTTP server

                    // NOTE to ensure atomicity at the filesystem level, we write out to a temporary file, and
                    // then move it into place, overwriting the old file

                    fs.writeFile(FORECASTS_DATA_TEMP_PATH, JSON.stringify(forecasts, null, 4), 'utf8',
                        function() {
                            fs.rename(FORECASTS_DATA_TEMP_PATH, FORECASTS_DATA_PATH,
                                function() {
                                    winston.info('aggregateForecasts: forecast data file updated; path: ' + FORECASTS_DATA_PATH);
                                }
                            );
                        }
                    );
                }
            }
        );
    }
}

function forecastForRegionId(regionId, onForecast) {

    var regionDetails = getRegionDetailsForRegionId(regionId);

    if (!regionDetails) {
        winston.warn('invalid regionId: ' + regionId);
        onForecast(regionId, null);
    } else {
        request({'url':regionDetails.dataURL, 'timeout': DATA_REQUEST_TIMEOUT_SECONDS * 1000},
            function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    winston.info('successful dataURL response; regionId: ' + regionDetails.regionId +
                        '; dataURL: ' + regionDetails.dataURL);
                    var forecast = regionDetails.parser(body, regionDetails);
                    onForecast(regionId, forecast);
                } else {
                    winston.warn('failed dataURL response; regionId: ' + regionDetails.regionId + '; dataURL: ' +
                        regionDetails.dataURL + '; response status code: ' + (response ? response.statusCode : '[no response]') + '; error: ' + error);
                    onForecast(regionId, null);
                }
            }
        );
    }
}

exports.getRegionDetailsForRegionId = getRegionDetailsForRegionId;
function getRegionDetailsForRegionId(regionId) {

    var regionDetails = null;

    if (regionId) {
        var components = regionId.split('_');

        if (components && components.length > 0) {

            // NOTE the URLs used here by the server for pull data may be different than the URLs for users viewing the
            // corresponding forecast as a web page
            var dataURL = null;
            var parser = null;
            switch (components[0]) {
                case 'nwac':
                    dataURL = 'http://www.nwac.us/forecast/avalanche/current/zone/' + components[1] + '/';
                    parser = parseForecast_nwac;
                    break;
                case 'cac':
                    // NOTE cac is sensitive to a trailing slash, don't put it in
                    dataURL = 'http://www.avalanche.ca/dataservices/cac/bulletins/xml/' + components[1];
                    parser = parseForecast_cac;
                    break;
                case 'pc':
                    dataURL = 'http://avalanche.pc.gc.ca/CAAML-eng.aspx?d=TODAY&r=' + components[1];
                    parser = parseForecast_pc;
                    break;
                default:
                    break;
            }

            if (dataURL) {
                regionDetails = {'regionId': regionId, 'provider': components[0], 'subregion': components[1], 'dataURL': dataURL, 'parser': parser};
                winston.verbose('regionDetails: ' + JSON.stringify(regionDetails));
            }
        }
    }

    return regionDetails;
}

exports.findHighestAviLevelInString = findHighestAviLevelInString;
function findHighestAviLevelInString(string) {

    // NOTE looks for the *highest* avi level keyword within the string

    var aviLevel = 0;

    // various cases handled:
    // * mixed case
    // * not matching keywords showing up inside other words, like "high" in "highway"
    // * no whitespace, whitespace, or multiple whitespace
    // * multiple keywords, same or different, within the string
    if (string) {
        var levelMatch = string.match(/\b(low|moderate|considerable|high|extreme)\b/gi);

        if (levelMatch && levelMatch.length > 0) {
            // scan the matches, and take the highest level found
            for (var i = 0; i < levelMatch.length; i++) {
                winston.verbose('levelMatch[' + i + ']: ' + levelMatch[i]);
                aviLevel = Math.max(aviLevel, aviLevelFromName(levelMatch[i]));
            }
        }
    }

    return aviLevel;
}

exports.aviLevelFromName = aviLevelFromName;
function aviLevelFromName(aviLevelName) {

    // convert avi level name to number

    var aviLevel = AVI_LEVEL_UNKNOWN;

    if (aviLevelName) {
        switch (aviLevelName.trim().toLowerCase()) {
            case 'low':
                aviLevel = AVI_LEVEL_LOW;
                break;
            case 'moderate':
                aviLevel = AVI_LEVEL_MODERATE;
                break;
            case 'considerable':
                aviLevel = AVI_LEVEL_CONSIDERABLE;
                break;
            case 'high':
                aviLevel = AVI_LEVEL_HIGH;
                break;
            case 'extreme':
                aviLevel = AVI_LEVEL_EXTREME;
                break;
            default:
                break;
        }
    }

    return aviLevel;
}

String.prototype.trim = function() {
    return this.replace(/^\s+/, '').replace(/\s+$/, '');
};

exports.parseForecast_nwac = parseForecast_nwac;
function parseForecast_nwac(body, regionDetails) {

    // nwac forecasts  have a timestamp that says when the forecast was issued; and then present the forecast
    // details labelled only by day of week, e.g. "Thursday: xxx". so to know exactly which dates they are
    // describing, we need to parse out both pieces and use them together.

    var forecast = null;

    // get the forecast issued date
    var forecastIssuedDate = parseForecastIssuedDate_nwac(body, regionDetails);

    if (forecastIssuedDate) {

        // NWAC forecasts go at most 3 days out, and often are 2 days out; choose the max we want to look for
        var NUM_FORECAST_DAYS_NWAC = 3;

        // using forecast issued date to anchor things, set up our forecast dates and days
        // start with the day the forecast was issued, and increment forward from there
        var forecastDates = [NUM_FORECAST_DAYS_NWAC];
        var forecastDays = [NUM_FORECAST_DAYS_NWAC];
        var aviLevels = [NUM_FORECAST_DAYS_NWAC];

        for (var i = 0; i < NUM_FORECAST_DAYS_NWAC; i++) {
            // copy the value of the forecast issued date, and then offset by the appropriate number of days
            forecastDates[i] = moment(moment(forecastIssuedDate).valueOf());
            moment(forecastDates[i].add('days',i));

            // get the day name for that date
            forecastDays[i] = moment(forecastDates[i]).format("dddd");

            aviLevels[i] = AVI_LEVEL_UNKNOWN;
        }

        // get the forecast details
        parseForecastValues_nwac(body, regionDetails, forecastDays, aviLevels);

        // fill out the return object
        forecast = [NUM_FORECAST_DAYS_NWAC];
        for (var j = 0; j < NUM_FORECAST_DAYS_NWAC; j++) {
            forecast[j] = {'date':moment(forecastDates[j]).format('YYYY-MM-DD'), 'aviLevel':aviLevels[j]};
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
}

function parseForecastIssuedDate_nwac(body, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical string for nwac: '<span class="dynamic">1445 PM PST Mon Jan 16 2012</span>'
    var timestampMatch = body.match(/<span class="dynamic">\s*\d+\s+\w+\s+\w+\s+\w+\s+(\w+\s+\d+\s+\d+)\s*<\/span>/);

    // the capture group from the regex will be in slot 1 in the array
    if (timestampMatch && timestampMatch.length > 1) {

        forecastIssuedDate = moment(timestampMatch[1], "MMM DD YYYY");
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    }

    return forecastIssuedDate;
}

function parseForecastValues_nwac(body, regionDetails, forecastDays, aviLevels) {
    // capture the set of forecast blocks within the body; typically there are 2 or 3
    // forecast blocks can potentially describe multiple days; can describe say "Thursday" vs. "Thursday night";
    // can describe days that have already passed; can contain multiple avi levels
    // NOTE typical string for nwac: '<strong>Monday:</strong> Considerable avalanche danger above 4000 feet and moderate below. Increasing danger Monday afternoon and night.<'
    var forecastBlocks = body.match(/<strong>[^:]+:[^<]*<\/strong>[^<]+</g);
    for ( var i = 0; i < forecastBlocks.length; i++) {
        winston.verbose('forecastBlocks[' + i + ']: ' + forecastBlocks[i]);
    }

    for (var day = 0; day < forecastDays.length; day++) {

        // look for the day name, case insensitive, before the colon
        var regExp = new RegExp(forecastDays[day] + '[^:]*:','i');

        // find the first block that contains the relevant day string, and extract the first avalanche keyword therein
        for (var block = 0; block < forecastBlocks.length; block++) {

            if (forecastBlocks[block].match(regExp)) {

                aviLevels[day] = findHighestAviLevelInString(forecastBlocks[block]);
                winston.verbose('parsing forecast values; regionId: ' + regionDetails.regionId + '; day: ' + day + '; day name: ' +
                    forecastDays[day] + '; block: ' + block + '; aviLevel: ' + aviLevels[day]);

                break;
            }
        }
    }
}

exports.parseForecast_cac = parseForecast_cac;
function parseForecast_cac(body, regionDetails) {

    var forecast = null;

    // NOTE eliminate the XML namespace prefixes, it screws up the JSON generated below
    body = body.replace(/caaml:/g,'');
    body = body.replace(/gml:/g,'');

    var parser = new xml2js.Parser();
    parser.parseString(body, function (err, result) {

        var forecastIssuedDate = dateStringFromDateTimeString_caaml(result.observations.Bulletin.validTime.TimePeriod.beginPosition);
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));

        var dayForecasts = result.observations.Bulletin.bulletinResultsOf.BulletinMeasurements.dangerRatings.DangerRating;

        // NOTE create an extra slot for the day the forecast was issued, as it may be the day before the first
        // described day; having a duplicate date in the result is ok
        forecast = [dayForecasts.length + 1];

        for (var i = 0; i < dayForecasts.length; i++) {

            var date = dateStringFromDateTimeString_caaml(dayForecasts[i].validTime.TimeInstant.timePosition);

            // NOTE cac organizes forecasts by multiple elevation zones within a given day;
            // take the highest danger level listed for each day
            var aviLevel = Math.max(
                aviLevelFromName(dayForecasts[i].dangerRatingAlpValue),
                aviLevelFromName(dayForecasts[i].dangerRatingTlnValue),
                aviLevelFromName(dayForecasts[i].dangerRatingBtlValue));

            // NOTE special case the forecast issued day, which is usually the day before the first described day,
            // and use the first described day's forecast for it
            // NOTE this also assumes the days are listed in chronological order in the input data
            if (i === 0) {
                forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};
            }

            // put this described day in the array, shifted by one position
            forecast[i+1] = {'date': date, 'aviLevel': aviLevel};
        }

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }

    });

    return forecast;
}

exports.parseForecast_pc = parseForecast_pc;
function parseForecast_pc(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser();
    parser.parseString(body, function (err, result) {

        var forecastIssuedDate = dateStringFromDateTimeString_caaml(result.observations.Bulletin.validTime.TimePeriod.beginPosition);
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));

        var dayForecasts = result.observations.Bulletin.bulletinResultsOf.BulletinMeasurements.dangerRatings.DangerRating;

        // NOTE create an extra slot for the day the forecast was issued, as it may be the day before the first
        // described day; having a duplicate date in the result is ok
        // NOTE pc lists each day three times, one for each elevation zone
        forecast = [(dayForecasts.length / 3) + 1];

        for (var i = 0; i < (dayForecasts.length / 3); i++) {

            var date = dateStringFromDateTimeString_caaml(dayForecasts[i].validTime.TimeInstant.timePosition);

            // NOTE pc organizes forecasts as separate entries for each elevation zone for each day;
            // the alpine evevation zone is always listed first, and always has the highest danger level of the
            // elevation zones, so we use it
            var aviLevel = parseInt(dayForecasts[i].mainValue);

            // NOTE special case the forecast issued day, which is usually the day before the first described day,
            // and use the first described day's forecast for it
            // NOTE this also assumes the days are listed in chronological order in the input data
            if (i === 0) {
                forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};
            }

            // put this described day in the array, shifted by one position
            forecast[i+1] = {'date': date, 'aviLevel': aviLevel};
        }

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }

    });

    return forecast;
}

exports.dateStringFromDateTimeString_caaml = dateStringFromDateTimeString_caaml;
function dateStringFromDateTimeString_caaml(dateTimeString) {
    // NOTE typical date string: '2012-02-02T18:14:00' or '2012-02-10T00:00:00Z'
    return dateTimeString.slice(0,10);
}
































