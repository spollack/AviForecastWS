//
// web server
//

var express = require('express');

var app = express.createServer(express.logger());

// path mapping
app.get('/region/:regionId', onRequest);

// use the value from the PORT env variable if available
var port = process.env.PORT || 5000;
app.listen(port,
    function() {
	    console.log('listening on ' + port);
    }
);

//
// request handling
//

var request = require('request');

// get the avalanche forecast info from the appropriate source, and return it to the originating client
// in all cases, some response will be sent to the client
// origRequest/origResponse are the client-originated HTTP request; not to be confused with
// the server to server request that we initiate here to query the appropriate forecast site
function onRequest(origRequest, origResponse) {
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
                    var aviLevel = parseForecast(body, regionId);
                    sendDataResponse(origResponse, aviLevel);
                } else {
                    console.log('error response; regionId: ' + regionId + '; URL: ' + URL + '; status code: ' + response.statusCode + '; error: ' + error);
                    sendNoDataAvailableResponse(origResponse);
                }
            }
        );
    }
}

function sendNoDataAvailableResponse(origResponse) {
    sendDataResponse(origResponse, 0);
}

function sendDataResponse(origResponse, aviLevel) {
    // BUGBUG use a real library for creating JSON
    var responseBody = ('{"aviLevel":' + String(aviLevel) + '}');

    origResponse.contentType('application/json');
    origResponse.send(responseBody);
}

function getURLForRegionId(regionId) {
    // NOTE this will have to be extended to support other avalanche forecast centers
    return 'http://www.nwac.us/forecast/avalanche/current/zone/' + regionId + '/';
}

function parseForecast(body, regionId) {
	var aviLevel = 0; 
	
	// scrape the website for the data we need
    // cases handled: mixed case; keywords like "high" showing up inside other words, like "highway"
    // NOTE this will have to be extended to support other avalanche forecast centers
    var match = body.match(/\W(low|moderate|considerable|high|extreme)\W/i);

    // the capture group from the regex will be in slot 1 in the array
	if (match && match.length > 1) {
        var matchLevel = match[1].toLowerCase();
		console.log('found regex match; regionId: ' + regionId + '; match: ' + matchLevel);
		switch(matchLevel) {
			case 'low':
				aviLevel = 1;
				break;
			case 'moderate':
				aviLevel = 2;
				break;
			case 'considerable':
				aviLevel = 3;
				break;
			case 'high':
				aviLevel = 4;
				break;
			case 'extreme':
				aviLevel = 5;
				break;
			default:
				break;
		}
	} else {
		console.log('no regex match; regionId: ' + regionId);
	}
	
	return aviLevel; 
}
