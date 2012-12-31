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
var fs = require('fs');
var winston = require('winston');
var request = require('request');
var moment = require('moment');
var _ = require('underscore');
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

    // BUGBUG how do we deal with centers shutting down for the season???

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
                // NOTE known exceptions: certain regions always return forecasts without danger level ratings
                if (regionId === 'caic_090' || regionId === 'caic_091') {
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
        // then offset to get to PST, which is what we use for our checking
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
            if (regionId === 'uac_moab_1' || regionId === 'uac_moab_2' || regionId === 'uac_skyline' || regionId === 'uac_uintas' || regionId === 'uac_logan') {
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

    if (!regionDetails) {
        winston.warn('invalid regionId: ' + regionId);
        onForecast(regionId, null);
    } else {
        request({url:regionDetails.dataURL, jar:false, timeout: forecasts.DATA_REQUEST_TIMEOUT_SECONDS * 1000},
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
                    dataURL = 'http://utahavalanchecenter.org/advisory/' + subregion;
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

    // nwac forecasts  have a timestamp that says when the forecast was issued; and then present the forecast details
    // labelled only by textual day of week, e.g. "Thursday" or "Friday night and Saturday"; so to know exactly
    // which dates they are describing, we need to parse out both pieces and use them together

    // nwac forecasts go at most 3 days out (issued on day 1, for day 2 and day 3)
    var NUM_FORECAST_DAYS_NWAC = 3;

    try {
        // convert the JSON response to an object
        var bodyJson = JSON.parse(body);

        // get the forecast issued date
        var forecastIssuedDate = moment(bodyJson.published_date, 'YYYY-MM-DD HH-mm-ss');

        if (forecastIssuedDate) {

            // using forecast issued date to anchor things, set up our forecast dates and days
            // start with the day the forecast was issued, and increment forward from there
            var forecastDates = [];
            var forecastDays = [];
            var aviLevels = [];

            for (var i = 0; i < NUM_FORECAST_DAYS_NWAC; i++) {
                // copy the value of the forecast issued date, and then offset by the appropriate number of days
                forecastDates[i] = moment(forecastIssuedDate).clone().add('days', i);

                // get the day name for that date
                forecastDays[i] = moment(forecastDates[i]).format('dddd');

                aviLevels[i] = forecasts.AVI_LEVEL_UNKNOWN;
            }

            // get the forecast details
            forecasts.parseForecastValues_nwac(bodyJson, regionDetails, forecastDays, aviLevels);

            if (aviLevels[0] === forecasts.AVI_LEVEL_UNKNOWN && aviLevels[1] !== forecasts.AVI_LEVEL_UNKNOWN) {
                // NOTE since nwac forecasts are typically issued in the evening for the following two days,
                // copy the forecast from that first forecast day into the forecast issued day too
                aviLevels[0] = aviLevels[1];
            }

            // fill out the return object
            forecast = [];
            for (var j = 0; j < aviLevels.length; j++) {
                forecast[j] = {'date':moment(forecastDates[j]).format('YYYY-MM-DD'), 'aviLevel':aviLevels[j]};
                winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
            }
        }

    } catch (e) {
        winston.warn('failure parsing NWAC forecast; error: ' + JSON.stringify(e));
    }

    return forecast;
};

forecasts.parseForecastValues_nwac = function(bodyJson, regionDetails, forecastDays, aviLevels) {

    for (var day = 0; day < forecastDays.length; day++) {

        // look for the day name, case insensitive
        var regExp = new RegExp(forecastDays[day], 'i');

        // find the first forecast label that contains the relevant day string
        // NOTE one-based index
        for (var forecastIndex = 1; forecastIndex <= aviLevels.length; forecastIndex++) {

            var labelName = 'label_forecast_day' + forecastIndex;
            if (bodyJson[labelName].match(regExp)) {

                // go get the corresponding forecast
                aviLevels[day] = forecasts.getAviLevelForForecastDayIndex_nwac(bodyJson, regionDetails, forecastIndex);
                winston.verbose('parsing forecast values; regionId: ' + regionDetails.regionId + '; day: ' + day + '; day name: ' +
                    forecastDays[day] + '; block: ' + forecastIndex + '; aviLevel: ' + aviLevels[day]);

                break;
            }
        }
    }
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

forecasts.parseForecast_simple_caaml = function(body, regionDetails) {

    var forecast = null;

    var parser = new xml2js.Parser(xml2js.defaults['0.1']);
    // NOTE this block is called synchronously with parsing, even though it looks async
    parser.parseString(body, function(err, result) {
        try {
            var forecastIssuedDate = forecasts.dateStringFromDateTimeString_caaml(result.validTime.TimePeriod.beginPosition);
            winston.verbose('found forecast issue date; regionId: ' + regionDetails.regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));

            var forecastValidThroughDate = forecasts.dateStringFromDateTimeString_caaml(result.validTime.TimePeriod.endPosition);

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

    var $ = cheerio.load(body, {lowerCaseTags:true, lowerCaseAttributeNames:true});

    var forecastIssuedDate = forecasts.parseForecastIssuedDate_uac($, regionDetails);
    var aviLevels = forecasts.parseForecastValues_uac($, regionDetails);

    // NOTE uac currently issues forecasts morning of, for one day only
    if (forecastIssuedDate) {
        forecast = [];
        forecast[0] = {'date': moment(forecastIssuedDate).format('YYYY-MM-DD'), 'aviLevel': aviLevels[0]};

        for (var j = 0; j < forecast.length; j++) {
            winston.verbose('regionId: ' + regionDetails.regionId + '; forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
};

forecasts.parseForecastIssuedDate_uac = function($, regionDetails) {

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical html fragment for uac: '<td class="advisory-date">Issued by Drew Hardesty for November 9, 2012 - 11:19am</td>'
    var textBlock = $('.advisory-date').text();

    var timestampMatch = textBlock.match(/for\s+(\w+\s+\d+)\w*\s*,?\s+(\d+)/);

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

forecasts.parseForecastValues_uac = function($, regionDetails) {

    // uac forecasts one days at a time
    var aviLevels = [];
    aviLevels[0] = forecasts.AVI_LEVEL_UNKNOWN;

    // NOTE typical html frament for uac: '<div id="upper-rating" class="rating-2"><span> <h2>2. Moderate</h2> Above 9,500 ft.</span> </div>'
    var dangerRatingTextBlocks = [];
    dangerRatingTextBlocks[0] = $('#upper-rating span h2').text();
    dangerRatingTextBlocks[1] = $('#mid-rating span h2').text();
    dangerRatingTextBlocks[2] = $('#lower-rating span h2').text();

    var dangerRatings = [];
    for (var i = 0; i < dangerRatingTextBlocks.length; i++) {
        dangerRatings[i] = forecasts.findHighestAviLevelInString(dangerRatingTextBlocks[i]);
    }

    aviLevels[0] = _.max(dangerRatings);

    return aviLevels;
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
            daysOfWeek[i] = moment(forecastIssuedDate).clone().add('days',i);

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

























