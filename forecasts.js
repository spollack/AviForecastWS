//
// Copyright (c) 2012 Sebnarware. All rights reserved.
//

//
// exports
//
var forecasts = module.exports = {};

//
// required packages
//
var winston = require('winston');
var request = require('request');
var moment = require('moment');
var xml2js = require('xml2js');
var fs = require('fs');


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
forecasts.DATA_REQUEST_TIMEOUT_SECONDS = 15;
forecasts.FORECAST_GEN_INTERVAL_SECONDS = 300;
forecasts.CACHE_MAX_AGE_SECONDS = 300;

// filepaths
forecasts.STATIC_FILES_DIR_PATH  = __dirname + '/public';
forecasts.REGIONS_PATH = __dirname + '/public/v1/regions.json';
forecasts.FORECASTS_DATA_PATH = __dirname + '/public/v1/forecasts.json';
forecasts.FORECASTS_DATA_TEMP_PATH = __dirname + '/public/v1/forecasts_TEMP.json';


forecasts.aggregateForecasts = function(regions) {
    winston.info('aggregateForecasts: initiated');

    var forecastsStatistics = {'count':regions.length, 'remainingCount':regions.length, 'invalidCount':0};
    var forecastsArray = [];

    for (var i = 0; i < regions.length; i++) {

        var regionId = regions[i].regionId;
        winston.verbose('generating forecast for regionId: ' + regionId);

        forecasts.forecastForRegionId(regionId,
            function(regionId, forecast) {

                var valid = forecasts.validateForecast(regionId, forecast, true);
                if (!valid) {
                    forecastsStatistics.invalidCount++;
                }

                // add the forecast to the forecasts array
                // NOTE the order of forecast generation completion is not deterministic, so they may end up in any
                // order in the array
                forecastsArray.push({'regionId':regionId, 'forecast':forecast});

                forecastsStatistics.remainingCount--;
                if (forecastsStatistics.remainingCount === 0) {
                    winston.info('aggregateForecasts: all forecasts processed, region count: ' + forecastsStatistics.count);
                    if (forecastsStatistics.invalidCount > 0) {
                        winston.warn('there were invalid forecasts; invalid forecast count: ' + forecastsStatistics.invalidCount);
                    } else {
                        winston.info('all forecasts valid');
                    }
                    winston.verbose(JSON.stringify(forecasts, null, 4));

                    // write the forecasts out to a static json file, that can be served by the HTTP server

                    // NOTE to ensure atomicity at the filesystem level, we write out to a temporary file, and
                    // then move it into place, overwriting the old file

                    fs.writeFile(forecasts.FORECASTS_DATA_TEMP_PATH, JSON.stringify(forecastsArray, null, 4), 'utf8',
                        function() {
                            fs.rename(forecasts.FORECASTS_DATA_TEMP_PATH, forecasts.FORECASTS_DATA_PATH,
                                function() {
                                    winston.info('aggregateForecasts: forecast data file updated; path: ' + forecasts.FORECASTS_DATA_PATH);
                                }
                            );
                        }
                    );
                }
            }
        );
    }
};

forecasts.validateForecast = function(regionId, forecast, validateForCurrentDay) {

    // BUGBUG how do i deal with centers shutting down for the season???

    var validForecast = true;

    if (!forecast) {
        // check for null forecast

        // NOTE known exceptions: these regions currently do not provide any danger level ratings
        if (regionId === 'cac_bighorn' || regionId === 'cac_north-rockies') {
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
                // NOTE known exceptions: certain regions always return forecasts without danger level ratings; others
                // // are only issued periodically (e.g. once a week), not daily
                if (regionId === 'caic_090' || regionId === 'caic_091' || regionId === 'uac_moab' || regionId === 'uac_skyline') {
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

    var validForecast = false;

    if (forecast) {
        // get the current date
        // NOTE this is in (server) local time...
        var today = moment().format('YYYY-MM-DD');

        for (var i = 0; i < forecast.length; i++) {
            if (forecast[i].date === today) {
                validForecast = true;
                winston.info('forecast validation: as expected, found forecast for current day; regionId: ' + regionId);
                break;
            }
        }

        if (!validForecast) {
            // NOTE known exceptions: certain regions do not issue new forecasts daily, so this case can happen
            if (regionId === 'uac_moab' || regionId === 'uac_skyline') {
                validForecast = true;
                winston.info('forecast validation: as expected, did not find forecast for current day; regionId: ' + regionId);
            } else {
                winston.warn('forecast validation: UNEXPECTED did not find forecast for current day; regionId: ' + regionId + '; forecast: ' + JSON.stringify(forecast));
            }
        }
    }

    return validForecast;
};

forecasts.forecastForRegionId = function(regionId, onForecast) {

    var regionDetails = forecasts.getRegionDetailsForRegionId(regionId);

    if (!regionDetails) {
        winston.warn('invalid regionId: ' + regionId);
        onForecast(regionId, null);
    } else {
        request({'url':regionDetails.dataURL, 'timeout': forecasts.DATA_REQUEST_TIMEOUT_SECONDS * 1000},
            function(error, response, body) {
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
};

forecasts.getRegionDetailsForRegionId = function(regionId) {

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
                    dataURL = forecasts.getDataURL_caic(components[1]);
                    parser = forecasts.parseForecast_caic;
                    break;
                case 'uac':
                    dataURL = 'http://utahavalanchecenter.org/advisory/' + components[1] + '/rss';
                    parser = forecasts.parseForecast_uac;
                    break;
                case 'viac':
                    dataURL = 'http://www.islandavalanchebulletin.com/';
                    parser = forecasts.parseForecast_viac;
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

forecasts.parseForecast_nwac = function(body, regionDetails) {

    // nwac forecasts  have a timestamp that says when the forecast was issued; and then present the forecast
    // details labelled only by day of week, e.g. "Thursday: xxx". so to know exactly which dates they are
    // describing, we need to parse out both pieces and use them together.

    var forecast = null;

    // get the forecast issued date
    var forecastIssuedDate = forecasts.parseForecastIssuedDate_nwac(body, regionDetails);

    if (forecastIssuedDate) {

        // NWAC forecasts go at most 3 days out, but often are 2 days out; choose the max we want to look for
        var NUM_FORECAST_DAYS_NWAC = 3;

        // using forecast issued date to anchor things, set up our forecast dates and days
        // start with the day the forecast was issued, and increment forward from there
        var forecastDates = [];
        var forecastDays = [];
        var aviLevels = [];

        for (var i = 0; i < NUM_FORECAST_DAYS_NWAC; i++) {
            // copy the value of the forecast issued date, and then offset by the appropriate number of days
            forecastDates[i] = moment(forecastIssuedDate).clone();
            moment(forecastDates[i].add('days',i));

            // get the day name for that date
            forecastDays[i] = moment(forecastDates[i]).format("dddd");

            aviLevels[i] = forecasts.AVI_LEVEL_UNKNOWN;
        }

        // get the forecast details
        forecasts.parseForecastValues_nwac(body, regionDetails, forecastDays, aviLevels);

        var daysActuallyForecast = NUM_FORECAST_DAYS_NWAC;
        if (aviLevels[NUM_FORECAST_DAYS_NWAC - 1] === forecasts.AVI_LEVEL_UNKNOWN) {
            // forecast was only for 2 days, not 3
            daysActuallyForecast--;
        }

        // fill out the return object
        forecast = [];
        for (var j = 0; j < daysActuallyForecast; j++) {
            forecast[j] = {'date':moment(forecastDates[j]).format('YYYY-MM-DD'), 'aviLevel':aviLevels[j]};
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseForecastIssuedDate_nwac = function(body, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical string for nwac: '<span class="dynamic">1445 PM PST Mon Jan 16 2012</span>'
    var timestampMatch = body.match(/<span class="dynamic">\s*\d+\s+\w+\s+\w+\s+\w+\s+(\w+\s+\d+\s+\d+)\s*<\/span>/);

    // the capture group from the regex will be in slot 1 in the array
    if (timestampMatch && timestampMatch.length > 1) {

        forecastIssuedDate = moment(timestampMatch[1], 'MMM DD YYYY');
        winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    } else {
        winston.warn('parse failure, forecast issue date not found; regionId: ' + regionDetails.regionId);
    }

    return forecastIssuedDate;
};

forecasts.parseForecastValues_nwac = function(body, regionDetails, forecastDays, aviLevels) {
    // first, pull out the relevant chunk of the page
    var forcastSectionStartIndex = body.indexOf('<h2>Forecast</h2>');
    var forcastSectionEndIndex = body.indexOf('<h2>Snowpack Analysis</h2>');

    if (forcastSectionStartIndex !== -1 && forcastSectionEndIndex !== -1) {
        var forecastSection = body.substring(forcastSectionStartIndex, forcastSectionEndIndex);

        winston.verbose('forecast section: ' + forecastSection);

        // capture the forecast blocks within; for nwac there are 2 or 3 (mixed in with non-forecast lines);
        // forecast blocks can potentially describe multiple days; can describe say "Thursday" vs. "Thursday night";
        // can describe days that have already passed; can contain multiple avi levels
        // NOTE assumes that each block is on a single line in the file; this appears to be a better heuristic than
        // using HTML tags, as nwac uses them inconsistently
        // NOTE typical string for nwac: '<p><strong>Friday:</strong> Moderate avalanche danger above about 4000 feet and low below. Slightly decreasing Friday night.</p>'
       var forecastBlocks = forecastSection.match(/[^\n]*\n/g);

        if (forecastBlocks) {
            for ( var i = 0; i < forecastBlocks.length; i++) {
                winston.verbose('forecastBlocks[' + i + ']: ' + forecastBlocks[i]);
            }

            for (var day = 0; day < forecastDays.length; day++) {

                // look for the day name, case insensitive, before the colon
                var regExp = new RegExp(forecastDays[day] + '[^:]*:','i');

                // find the first block that contains the relevant day string, and extract the first avalanche keyword therein
                for (var block = 0; block < forecastBlocks.length; block++) {

                    if (forecastBlocks[block].match(regExp)) {

                        aviLevels[day] = forecasts.findHighestAviLevelInString(forecastBlocks[block]);
                        winston.verbose('parsing forecast values; regionId: ' + regionDetails.regionId + '; day: ' + day + '; day name: ' +
                            forecastDays[day] + '; block: ' + block + '; aviLevel: ' + aviLevels[day]);

                        break;
                    }
                }
            }
        } else {
            winston.warn('parse failure, no blocks found; regionId: ' + regionDetails.regionId);
        }
    } else {
        winston.warn('parse failure, no forecast section found; regionId: ' + regionDetails.regionId);
    }
};

forecasts.parseForecast_cac = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser();
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
                var aviLevel = Math.max(
                    forecasts.aviLevelFromName(dayForecasts[i]['caaml:dangerRatingAlpValue']),
                    forecasts.aviLevelFromName(dayForecasts[i]['caaml:dangerRatingTlnValue']),
                    forecasts.aviLevelFromName(dayForecasts[i]['caaml:dangerRatingBtlValue']));

                // NOTE copy the first described day's forcast to the day before (see note above)
                // NOTE this also assumes the days are listed in chronological order in the input data
                if (i === 0) {
                    // calculate the day before
                    var dayBeforeFirstDate = moment(date, 'YYYY-MM-DD').subtract('days',1);
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

forecasts.parseForecast_pc = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser();
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
                var aviLevel = parseInt(dayForecasts[i].mainValue);

                // NOTE copy the first described day's forcast to the day before (see note above)
                // NOTE this also assumes the days are listed in chronological order in the input data
                if (i === 0) {
                    // calculate the day before
                    var dayBeforeFirstDate = moment(date, 'YYYY-MM-DD').subtract('days',1);
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

forecasts.parseForecast_caic = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser();
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDate = forecasts.dateStringFromDateTimeString_caaml(result.validTime.TimePeriod.beginPosition);
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));

            var forecastValidThroughDate = forecasts.dateStringFromDateTimeString_caaml(result.validTime.TimePeriod.endPosition);

            var aviLevel = parseInt(result.bulletinResultsOf.BulletinMeasurements.dangerRatings.DangerRatingSingle.mainValue);

            // NOTE caic issues avalanche forcasts for 24 hours at a time (issued in the morning, for that day and the next
            // early morning, so spanning two days)
            forecast = [];
            forecast[0] = {'date': forecastIssuedDate, 'aviLevel': aviLevel};
            forecast[1] = {'date': forecastValidThroughDate, 'aviLevel': aviLevel};

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

    var forecastIssuedDate = forecasts.parseForecastIssuedDate_uac(body, regionDetails);
    var aviLevels = forecasts.parseForecastValues_uac(body, regionDetails);

    if (forecastIssuedDate) {
        forecast = [];
        forecast[0] = {'date': moment(forecastIssuedDate).format('YYYY-MM-DD'), 'aviLevel': aviLevels[0]};
//        forecast[1] = {'date': moment(forecastIssuedDate).add('days',1).format('YYYY-MM-DD'), 'aviLevel': aviLevels[1]};

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseForecastIssuedDate_uac = function(body, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical string for uac: '    [title] =&gt; Sunday, February 19th 2012'
    var timestampMatch = body.match(/\[title\]\s*=&gt;\s*\w+\s*,?\s*(\w+\s+\d+)\w*\s*,?\s+(\d+)/);

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

forecasts.parseForecastValues_uac = function(body, regionDetails) {

    // uac forecasts two days at a time
    var aviLevels = [];
    for (var i = 0; i < 2; i++) {
        aviLevels[i] = forecasts.AVI_LEVEL_UNKNOWN;
    }

    // NOTE typical string for uac: '    [extendedforecast_rating_0] =&gt; Considerable'
    var dangerRatingMatch0 = body.match(/\[extendedforecast_rating_0\]\s*=&gt;\s*(.\w+)/);
    var dangerRatingMatch1 = body.match(/\[extendedforecast_rating_1\]\s*=&gt;\s*(.\w+)/);

    // the capture groups from the regex will be in slot 1 in each array
    if (dangerRatingMatch0 && dangerRatingMatch0.length > 1 && dangerRatingMatch1 && dangerRatingMatch1.length > 1) {
        aviLevels[0] = forecasts.findHighestAviLevelInString(dangerRatingMatch0[1]);
        aviLevels[1] = forecasts.findHighestAviLevelInString(dangerRatingMatch1[1]);
    } else {
        winston.warn('parse failure, danger levels not found; regionId: ' + regionDetails.regionId);
    }

    return aviLevels;
};

forecasts.parseForecast_viac = function(body, regionDetails) {

    var forecast = null;

    var forecastIssuedDate = forecasts.parseForecastIssuedDate_viac(body, regionDetails);
    var aviLevels = forecasts.parseForecastValues_viac(body, regionDetails);

    if (forecastIssuedDate && aviLevels) {
        forecast = [];
        for (var i = 0; i < aviLevels.length; i++) {
            forecast[i] = {'date': moment(forecastIssuedDate).clone().add('days', i).format('YYYY-MM-DD'), 'aviLevel': aviLevels[i]};
        }

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
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

forecasts.parseForecastValues_viac = function(body, regionDetails) {

    // viac forecasts three days at a time
    var aviLevels = [];
    for (var i = 0; i < 3; i++) {
        aviLevels[i] = forecasts.AVI_LEVEL_UNKNOWN;
    }

    // NOTE typical string for viac:
    //    <tr>
    //    <th>Outlook</th><th>Friday</th><th>Saturday<br /></th><th>Sunday<br /></th>
    //    </tr>
    //    <tr>
    //    <td><strong>Alpine</strong><br /></td>
    //    <td style="background-color: #ffdd77;">HIGH<br /></td>
    //    <td style="background-color: #ffdd77;">CONSIDERABLE</td>
    //    <td style="background-color: #ffdd77;">CONSIDERABLE</td>
    //    </tr>

    var dangerRatingMatch = body.match(/<td><strong>Alpine<\/strong><br \/><\/td>\s*\n(\s*<td.*<\/td>\s*\n)(\s*<td.*<\/td>\s*\n)(\s*<td.*<\/td>\s*\n)/i);

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































