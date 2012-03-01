//
// Copyright (c) 2012 Sebnarware. All rights reserved.
//

//
// required packages
//
var winston = require('winston');
var express = require('express');
var gzippo = require('gzippo');
var fs = require('fs');
var forecasts = require('./forecasts.js');


runServer();

function runServer() {

    configLogger();

    initializeForecastProcessing();

    startHTTPServer();
}

function configLogger() {
    // remove the default transport, so that we can reconfigure it
    winston.remove(winston.transports.Console);

    // verbose, info, warn, error are the log levels we're using
    winston.add(winston.transports.Console, {level:'info', handleExceptions:true});

    if (process.env.DEBUG) {
        winston.info('development mode, NOT logging to Loggly');
    } else {
        winston.info('production mode, logging to Loggly');
        winston.add(winston.transports.Loggly, {level:'info', handleExceptions:true, subdomain:'aviforecast', inputToken:'1e07b218-655c-4003-998e-cedd5112169e'});
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

    var app = express.createServer();

    // set up the express middleware, in the order we want it to execute

    // enable web server logging; pipe those log messages through winston
    var winstonStream = {
        write: function(str){
            winston.info(str);
        }
    };
    app.use(express.logger({stream:winstonStream}));
    // serve static content, compressed
    app.use(gzippo.staticGzip(forecasts.STATIC_FILES_DIR_PATH, {clientMaxAge:(forecasts.CACHE_MAX_AGE_SECONDS * 1000)}));
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
































