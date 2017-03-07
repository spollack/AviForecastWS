//
// required packages
//
var fs = require('fs');
var underscore = require('underscore');
var winston = require('winston');
var express = require('express');
var request = require('request');
var cheerio = require('cheerio');
var forecasts = require('./forecasts.js');
var observations = require('./observations.js');


runServer();

function runServer() {

    configureLogger();

    initializeForecastProcessing();

    startHTTPServer();
}

function configureLogger() {

    var localLogFilePath = '/tmp/aviforecast-log.txt';
    
    // remove the default transport, so that we can reconfigure it
    winston.remove(winston.transports.Console);

    // NOTE verbose, info, warn, error are the log levels we're using
    winston.add(winston.transports.Console,
        {
            level:'info',
            timestamp:!(process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') // the heroku envs already have timestamps
        });

    if (!(process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging')) {
        winston.add(winston.transports.File, {level:'info', timestamp:true, json:false, filename:localLogFilePath});
        winston.info('main_configureLogger NOT production or staging mode; local logfile is at: ' + localLogFilePath);
    }
}


function initializeForecastProcessing() {

    var regions = JSON.parse(fs.readFileSync(forecasts.REGIONS_PATH, 'utf8'));

    // generate the forecast content
    forecasts.aggregateForecasts(regions);

    // configure a timer to regenerate the forecast content on a recurring basis
    setInterval(forecasts.aggregateForecasts, forecasts.FORECAST_GEN_INTERVAL_SECONDS * 1000, regions);
}

function startHTTPServer() {

    var app = express();

    // set up the express middleware, in the order we want it to execute

    // enable web server logging; pipe those log messages through winston
    var winstonStream = {
        write: function(str){
            winston.info(str);
        }
    };
    app.use(express.logger({stream:winstonStream}));
    
    // compress responses
    app.use(express.compress());
    
    // enable jade template rendering
    app.set('views', forecasts.TEMPLATE_FILES_DIR_PATH);
    app.set('view engine', 'jade');
    app.enable('view cache');

    // serve our website templates
    app.get('/', function (req, res) {
        res.render('index', {});
    });
    app.get('/partners', function (req, res) {
        res.render('partners', {});
    });

    // parse request bodies, including file uploads
    app.use(express.bodyParser({keepExtensions: true}));

    // support observation uploads
    app.post('/v1/observation', function (req, res) {
        
        var observation = underscore.pick(req.body, ['providerId', 'observerEmail', 'latitude', 'longitude', 'timestampUtc', 'notes']);
        observation.image = (req.files ? req.files.image : null);

        winston.info('received observation; contents: ' + JSON.stringify(observation));

        if (!observation.providerId) {
            // bad request, some parameter we require was missing
            res.send(400);
        } else {
            observations.processObservation(observation, function(error) {
                if (!error) {
                    res.send(200);
                } else {
                    res.send(500);
                }
            });
        }
    });


    //
    // BEGIN PROXYING HACK
    //

    // BUGBUG hack to get around problem caching CAIC web pages on android due to cache-control:no-store header; 
    // proxy their content to avoid these headers being sent to the client
    app.get('/v1/proxy/caic/:zone', function(req, res) {
        var baseUrl = 'http://avalanche.state.co.us/';
        var url = baseUrl + 'caic/pub_bc_avo.php?zone_id=' + req.params.zone;
        proxy(url, baseUrl, res);
    });

    function proxy(url, baseUrl, res) {
        request({url:url, jar:false, timeout: forecasts.DATA_REQUEST_TIMEOUT_SECONDS * 1000},
            function(error, response, body) {
                if (!error && response.statusCode === 200) {
                    winston.info('successful proxy response; url: ' + url);
                    body = fixRelativeLinks(baseUrl, body);
                    res.send(body);
                } else {
                    winston.warn('failed proxy response; url: ' + url + '; response status code: ' + (response ? response.statusCode : '[no response]') + '; error: ' + error);
                    res.send(503);
                }
            }
        );
    }

    function fixRelativeLinks(baseUrl, body) {
        // NOTE some sites use relative links, but don't specify the base url, which breaks things when
        // going through our explicit proxy; so fix the pages by putting in a <base> tag
        var $ = cheerio.load(body, {lowerCaseTags:true, lowerCaseAttributeNames:true});
        $('head').prepend('<base href=' + baseUrl + '>');
        return $.html();
    }
    
    //
    // END PROXYING HACK
    //

    
    // serve static content
    app.use(express.static(forecasts.STATIC_FILES_DIR_PATH, {maxAge: forecasts.CACHE_MAX_AGE_SECONDS * 1000 }));

    // handle errors gracefully
    app.use(express.errorHandler());

    // use the value from the PORT env variable if available, fallback if not
    var port = process.env.PORT || 5000;

    app.listen(port,
        function () {
            // NOTE if you don't get this log message, then the http server didn't start correctly;
            // check if another instance is already running...
            winston.info('HTTP server listening on port: ' + port);
        }
    );
}
































