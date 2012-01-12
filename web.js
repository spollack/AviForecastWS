//
// web server
//

var express = require('express');

var app = express.createServer(express.logger());

app.get('/region/:id', onRequest);

// use the value from the PORT env variable if available
var port = process.env.PORT || 5000;
app.listen(port, function() {
	console.log("Listening on " + port);
});

//
// request handling
//

var request = require('request');

// origRequest/origResponse are the client-originated HTTP request; not to be confused with
// the server to server request that we initiate here
function onRequest(origRequest, origResponse) {
	var aviLevel = 0; 
	var URL = 'http://www.nwac.us/forecast/avalanche/current/zone/6/';
	request(URL, function (error, response, body) {
		if (!error && response.statusCode === 200) {
			console.log("Got a successful response; URL: " + URL);
			aviLevel = parseForecast(body, URL); 
		} else {
			console.log("Got an error; URL: " + URL + "; status code: " + response.statusCode + "; error: " + error);
		}
		
		// send response back to the originating client
//		origResponse.send('Hello ' + origRequest.params.id + '!\n');
		origResponse.send(String(aviLevel));
	});
}

function parseForecast(body, URL) {
	var aviLevel = 0; 
	
	// find the first match for this regex
    // NOTE this will have to be refined...
	var match = body.match(/(low|moderate|considerable|high|extreme) avalanche danger/i);
	
	if (match && match.length > 1) {
        var matchLevel = match[1].toLowerCase();
		console.log('Found regex; URL: ' + URL + '; match: ' + matchLevel);
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
		console.log('No regex match; URL: ' + URL);
	}
	
	return aviLevel; 
}
