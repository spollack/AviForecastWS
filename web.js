//
// web server
//

var express = require('express');

var app = express.createServer(express.logger());

app.get('/region/:id', onRequest);

// use the value from the PORT env variable if available
var port = process.env.PORT || 5000;
app.listen(port, function() {
	console.log('Listening on ' + port);
});

//
// request handling
//

var request = require('request');

// origRequest/origResponse are the client-originated HTTP request; not to be confused with
// the server to server request that we initiate here
function onRequest(origRequest, origResponse) {
	var aviLevel = 0;
    var id = origRequest.params.id;
	var URL = getURLFromId(id);

    if (!URL) {
        console.log('Invalid id: ' + id);
        // BUGBUG handling of errors on the client???
        origResponse.send('ERROR: invalid id');
    } else {
        request(URL, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                console.log('Successful response; id: ' + id + '; URL: ' + URL);
                aviLevel = parseForecast(body, id);
            } else {
                console.log('Error response; id: ' + id + '; URL: ' + URL + '; status code: ' + response.statusCode + '; error: ' + error);
            }

            // send data response back to the originating client
            origResponse.send(String(aviLevel));
        });
    }
}

function getURLFromId(id) {
    // NOTE this will have to be refined...
    return 'http://www.nwac.us/forecast/avalanche/current/zone/' + id + '/';
}

function parseForecast(body, id) {
	var aviLevel = 0; 
	
	// find the first match for this regex
    // NOTE this will have to be refined...
	var match = body.match(/(low|moderate|considerable|high|extreme) avalanche danger/i);
	
	if (match && match.length > 1) {
        var matchLevel = match[1].toLowerCase();
		console.log('Found regex; id: ' + id + '; match: ' + matchLevel);
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
		console.log('No regex match; id: ' + id);
	}
	
	return aviLevel; 
}
