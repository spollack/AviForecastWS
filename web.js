//
// web server
//

var express = require('express');

var app = express.createServer(express.logger());

// path mapping
app.get('/region/:id', onRequest);

// use the value from the PORT env variable if available
var port = process.env.PORT || 5000;
app.listen(port, function() {
	console.log('listening on ' + port);
});

//
// request handling
//

var request = require('request');

// get the avalanche forecast info from the appropriate source, and return it to the originating client
// in all cases, some response will be sent to the client
// origRequest/origResponse are the client-originated HTTP request; not to be confused with
// the server to server request that we initiate here to query the appropriate forecast site
function onRequest(origRequest, origResponse) {
    var id = origRequest.params.id;
	var URL = getURLFromId(id);

    if (!URL) {
        console.log('invalid id received from client; id: ' + id);
        origResponse.send(noDataAvailableResponse());
    } else {
        request(URL, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                console.log('successful response; id: ' + id + '; URL: ' + URL);
                var aviLevel = parseForecast(body, id);
                responseBody = (String(aviLevel));
                origResponse.send(responseBody);
            } else {
                console.log('error response; id: ' + id + '; URL: ' + URL + '; status code: ' + response.statusCode + '; error: ' + error);
                origResponse.send(noDataAvailableResponse());
            }
        });
    }
}

function noDataAvailableResponse() {
    return String(0);
}

function getURLFromId(id) {
    // NOTE this will have to be extended to support other avalanche forecast centers
    return 'http://www.nwac.us/forecast/avalanche/current/zone/' + id + '/';
}

function parseForecast(body, id) {
	var aviLevel = 0; 
	
	// scrape the website for the data we need
    // cases handled: mixed case, extra or no spaces between words
    // NOTE this will have to be extended to support other avalanche forecast centers
	var match = body.match(/(low|moderate|considerable|high|extreme)\s*avalanche\s*danger/i);

    // the capture group from the regex will be in slot 1 in the array
	if (match && match.length > 1) {
        var matchLevel = match[1].toLowerCase();
		console.log('found regex match; id: ' + id + '; match: ' + matchLevel);
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
		console.log('no regex match; id: ' + id);
	}
	
	return aviLevel; 
}
