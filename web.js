//
// required packages
//

var express = require('express');
var gzippo = require('gzippo');
var request = require('request');
var moment = require('moment');


//
// constants
//

var NUM_FORECAST_DAYS = 3;

var AVI_LEVEL_UNKNOWN = 0;
var AVI_LEVEL_LOW = 1;
var AVI_LEVEL_MODERATE = 2;
var AVI_LEVEL_CONSIDERABLE = 3;
var AVI_LEVEL_HIGH = 4;
var AVI_LEVEL_EXTREME = 5;


//
// general helpers
//

String.prototype.trim = function() {
    return this.replace(/^\s+/, '').replace(/\s+$/, '');
};


//
// HTTP server
//

runServer();

function runServer() {

    var app = express.createServer();

    app.use(express.logger());
    // take our explicit app routes in preference to serving static content
    app.use(app.router);
    // set the max age to 1 second, so that the client should then check If-Modified-Since after that time period
    // NOTE would set this to zero, but a bug in gzippo prevents this
    app.use(gzippo.staticGzip(__dirname + '/public', {clientMaxAge: 1000}));

    // path mapping
    app.get('/v1/regions', onRequestRegions_v1);
    app.get('/v1/region/:regionId', onRequestRegion_v1);

    // use the value from the PORT env variable if available, fallback if not
    var port = process.env.PORT || 5000;

    app.listen(port,
        function() {
            console.log('listening on ' + port);
        }
    );
}


//
// request handling
//

function onRequestRegions_v1(origRequest, origResponse) {
    origResponse.contentType('application/json');
    origResponse.sendfile('public/v1/regions.json');
}

// get the avalanche forecast info from the appropriate source, and return it to the originating client
//
// origRequest/origResponse are the client-originated HTTP request; not to be confused with
// the server to server request that we initiate here to query the appropriate forecast site
function onRequestRegion_v1(origRequest, origResponse) {
    var regionId = origRequest.params.regionId;
	var URL = getURLForRegionId(regionId);

    if (!URL) {
        console.log('invalid regionId received from client; regionId: ' + regionId);
        sendNoDataAvailableResponse(origResponse);
    } else {
        request(URL,
            function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    console.log('successful response; regionId: ' + regionId + '; URL: ' + URL);
                    var forecast = parseForecast(body, regionId);
                    sendDataResponse(origResponse, forecast);
                } else {
                    console.log('error response; regionId: ' + regionId + '; URL: ' + URL + '; status code: ' + response.statusCode + '; error: ' + error);
                    sendNoDataAvailableResponse(origResponse);
                }
            }
        );
    }
}

function sendNoDataAvailableResponse(origResponse) {
    sendDataResponse(origResponse, null);
}

function sendDataResponse(origResponse, forecast) {

    origResponse.contentType('application/json');

    if (forecast) {
        origResponse.send(JSON.stringify(forecast));
    } else {
        origResponse.send();
    }
}

function getURLForRegionId(regionId) {
    var URL = null;

    if (regionId) {
        var components = regionId.split('_');
        if (components.length > 1) {
            switch (components[0]) {
                case 'nwac':
                    URL = 'http://www.nwac.us/forecast/avalanche/current/zone/' + components[1] + '/';
                    break;
                case 'cac':
                    URL = 'http://www.avalanche.ca/cac/bulletins/latest/' + components[1] + '/';
                    break;
                default:
                    break;
            }
        }
    }
    
    return URL;
}

// avalanche forecasts typically have a timestamp that says when the forecast was issued; and then present
// the forecast details labelled only by day of week, e.g. "Thursday: xxx". so to know exactly which dates
// they are describing, we need to parse out both pieces and use them together.
function parseForecast(body, regionId) {

    var forecast = null;

    // BUGBUG will need to change this to the forecast first date, to generalize to cac

    // get the forecast issued date
    var forecastIssuedDate = parseForecastIssuedDate(body, regionId);

    if (forecastIssuedDate) {

        // using forecast issued date to anchor things, set up our forecast dates and days
        // start with the day the forecast was issued, and increment forward from there
        var forecastDates = [NUM_FORECAST_DAYS];
        var forecastDays = [NUM_FORECAST_DAYS];
        var aviLevels = [NUM_FORECAST_DAYS];

        for (var i = 0; i < NUM_FORECAST_DAYS; i++) {
            // copy the value of the forecast issued date, and then offset by the appropriate number of days
            forecastDates[i] = moment(moment(forecastIssuedDate).valueOf());
            moment(forecastDates[i].add('days',i));

            // get the day name for that date
            forecastDays[i] = moment(forecastDates[i]).format("dddd");

            aviLevels[i] = AVI_LEVEL_UNKNOWN;
        }

        // get the forecast details
        parseForecastValues(body, regionId, forecastDays, aviLevels);

        // fill out the return object
        forecast = [NUM_FORECAST_DAYS];
        for (var j = 0; j < NUM_FORECAST_DAYS; j++) {
            forecast[j] = {'date':moment(forecastDates[j]).format('YYYY-MM-DD'), 'aviLevel':aviLevels[j]};
            console.log('forecast[' + j + ']: ' + JSON.stringify(forecast[j]));
        }
    }

    return forecast;
}

// looks for the *highest* avi level keyword within the string
function findAviLevel(string) {

    var aviLevel = 0;

    // various cases handled:
    // * mixed case
    // * keywords showing up inside other words, like "high" in "highway"
    // * no whitespace, multiple whitespace, or non-whitespace before or after keyword
    // * multiple keywords, same or different, within the string
    var levelMatch = string.match(/\W(low|moderate|considerable|high|extreme)\W/gi);

    if (levelMatch && levelMatch.length > 0) {
        // scan the matches, and take the highest level found
        for (var i = 0; i < levelMatch.length; i++) {
            console.log('levelMatch[' + i + ']: ' + levelMatch[i]);
            aviLevel = Math.max(aviLevel, aviLevelFromName(levelMatch[i]));
        }
    }

    return aviLevel;
}

// convert avi level name to number
function aviLevelFromName(aviLevelName) {

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

function parseForecastIssuedDate(body, regionId) {
    // BUGBUG nwac specific; this will have to be extended to support other avalanche forecast centers

    var forecastIssuedDate = null;

    // capture the forecast timestamp
    // NOTE typical string for nwac: '<span class="dynamic">1445 PM PST Mon Jan 16 2012</span>'
    var timestampMatch = body.match(/<span class="dynamic">\s*\d+\s+\w+\s+\w+\s+\w+\s+(\w+\s+\d+\s+\d+)\s*<\/span>/);
    // the capture group from the regex will be in slot 1 in the array
    if (timestampMatch && timestampMatch.length > 1) {

        forecastIssuedDate = moment(timestampMatch[1], "MMM DD YYYY");
        console.log('found forecast issue date; regionId: ' + regionId + '; forecastIssuedDate: ' + moment(forecastIssuedDate).format('YYYY-MM-DD'));
    }

    return forecastIssuedDate;
}

function parseForecastValues(body, regionId, forecastDays, aviLevels) {
    // BUGBUG nwac specific; this will have to be extended to support other avalanche forecast centers

    // capture the set of forecast blocks within the body; typically there are 2 or 3
    // forecast blocks can potentially describe multiple days; can describe say "Thursday" vs. "Thursday night";
    // can describe days that have already passed; can contain multiple avi levels
    // NOTE typical string for nwac: '<strong>Monday:</strong> Considerable avalanche danger above 4000 feet and moderate below. Increasing danger Monday afternoon and night.<'
    var forecastBlocks = body.match(/<strong>[^:]+:[^<]*<\/strong>[^<]+</g);
    for ( var i = 0; i < forecastBlocks.length; i++) {
        console.log('forecastBlocks[' + i + ']: ' + forecastBlocks[i]);
    }

    for (var day = 0; day < NUM_FORECAST_DAYS; day++) {

        // look for the day name, case insensitive, before the colon
        var regExp = new RegExp(forecastDays[day] + '[^:]*:','i');

        // find the first block that contains the relevant day string, and extract the first avalanche keyword therein
        for (var block = 0; block < forecastBlocks.length; block++) {

            if (forecastBlocks[block].match(regExp)) {

                aviLevels[day] = findAviLevel(forecastBlocks[block]);
                console.log('parsing forecast values; regionId: ' + regionId + '; day: ' + day + '; day name: ' +
                    forecastDays[day] + '; block: ' + block + '; aviLevel: ' + aviLevels[day]);

                break;
            }
        }
    }
}




















