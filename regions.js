//
// exports
//
var regions = module.exports = {};

//
// required packages
//
var fs = require('fs');
var winston = require('winston');
var request = require('request');
var forecasts = require('./forecasts.js');

// region constants
regions.DATA_REQUEST_TIMEOUT_SECONDS = 15;
regions.DATA_MULTIPOLYGON_TYPE = 'MultiPolygon';
regions.NAC_DATA_URL = 'https://api.avalanche.org/v2/public/products/map-layer';
regions.CANADIAN_METADATA_URL = 'https://api.avalanche.ca/forecasts/en/metadata';
regions.CANADIAN_DATA_URL = 'https://api.avalanche.ca/forecasts/en/areas';
regions.REGIONS_GEN_INTERVAL_SECONDS = 60*60*24;

// filepaths
regions.REGIONS_PATH = __dirname + '/public/v1/regions.json';
regions.REGIONS_DATA_TEMP_PATH = __dirname + '/public/v1/regions_TEMP.json';

regions.regenerateRegions = async function() {
    winston.info('regenerateRegions: initiated');
    var NACData = getNACData();
    var CanadianMetadata = await getCanadianMetadata()
    .catch(function(reject) {
        winston.warn('regenerateRegions: UNEXPECTED error with Canadian metadata: ' + reject);
        return false;
    });
    var CanadianData = getCanadianData(CanadianMetadata);
    Promise.all([NACData, CanadianData]).then(data => {
        var combinedRegions = data[0].concat(data[1]);
        writeRegionsFile(JSON.stringify(combinedRegions, null, 4));
        forecasts.aggregateForecasts(combinedRegions);
    })
    .catch(function(reject) {
        winston.warn('regenerateRegions: UNEXPECTED error with source data: ' + reject);
        return false;
    });
};


function writeRegionsFile(regionData) {
    winston.info('writeRegionsFile: intiated');
    fs.writeFile(regions.REGIONS_DATA_TEMP_PATH, regionData, 'utf8',
        function() {
            fs.rename(regions.REGIONS_DATA_TEMP_PATH, regions.REGIONS_PATH,
                function() {
                    winston.info('writeRegionsFile: regions file updated; path: ' + regions.REGIONS_PATH);
                }
            );
        }
    );
}

function getCanadianMetadata() {
    return new Promise((resolve, reject) => {
        winston.info('getCanadianMetadata: initiated');
        var dataURL = regions.CANADIAN_METADATA_URL

        var requestOptions = {
            url:dataURL,
            jar:false,
            timeout:(regions.DATA_REQUEST_TIMEOUT_SECONDS * 1000)
        };

        request(requestOptions,
            function(error, response, body) {
                if (!error) {
                    winston.info('getCanadianMetadata: successful canadian metadata response; ' +  dataURL);
                    try {
                        var metadata = processCanadianMetadata(body);
                        resolve(metadata);
                    } catch (e) {
                        reject('getCanadianMetadata: parse failure of canadian metadata; exception: ' + e);
                    }
                } else {
                    reject('getCanadianMetadata: failed canadian metadata response; dataURL: ' + dataURL + '; response status code: ' + (response ? response.statusCode : '[no response]') + '; error: ' + error);
                }
            }
        );
    });
}

async function getCanadianData(metadata) {
    return new Promise((resolve, reject) => {
        winston.info('getCanadianData: initiated');;
        var dataURL = regions.CANADIAN_DATA_URL;

        var requestOptions = {
            url:dataURL,
            jar:false,
            timeout:(regions.DATA_REQUEST_TIMEOUT_SECONDS * 1000)
        };

        request(requestOptions,
            function(error, response, body) {
                if (!error) {
                    winston.info('getCanadianData: successful canadian region data response: ' +  dataURL);
                    try {
                        var fullRegionsData = processCanadianRegions(metadata, body, 3);
                        resolve(fullRegionsData);
                    } catch (e) {
                        reject('getCanadianData: parse failure of canadian region data; exception: ' + e);
                    }
                } else {
                    reject('getCanadianData: failed canadian region data response; dataURL: ' + dataURL + '; response status code: ' + (response ? response.statusCode : '[no response]') + '; error: ' + error);
                }
            }
        );
    });
}

function getNACData() {
    return new Promise((resolve, reject) => {
        winston.info('getNACData: initiated');
        dataURL = regions.NAC_DATA_URL;

        var requestOptions = {
            url:dataURL,
            headers:{'User-Agent':'avalancheforecasts.com'},
            jar:false,
            timeout:(regions.DATA_REQUEST_TIMEOUT_SECONDS * 1000)
        };
        request(requestOptions,
            function(error, response, body) {
                if (!error) {
                    winston.info('getNACData: successful nac region data response: ' +  dataURL);
                    try {
                        var fullRegionsData = processNACRegions(body, 3);
                        resolve(fullRegionsData);
                    } catch (e) {
                        reject('getNACData: parse failure of nac region data; exception: ' + e);
                    }
                } else {
                    reject('getNACData: failed nac region data response; dataURL: ' + dataURL + '; response status code: ' + (response ? response.statusCode : '[no response]') + '; error: ' + error);
                }
            }
        );
    });
}

function processCanadianMetadata(input) {
    winston.info('processCanadianMetadata: initiated');
    var data = JSON.parse(input);
    var metadata = {};
    for (var i = 0; i < data.length; i++) {
        var caId = data[i].area.id;
        metadata[caId] = {};
        metadata[caId].regionId = 'ca_' + data[i].product.slug;
        metadata[caId].displayName = data[i].area.name;
        metadata[caId].URL = data[i].url;
        metadata[caId].centerId = data[i].owner.value;
    }
    return metadata;
}


function processCanadianRegions(metadata, input, digits) {
    winston.info('processCanadianRegions: initiated');
    var data = JSON.parse(input);
    var regionData = data.features;
    var formattedRegions = [];
    for (var i = 0; i < regionData.length; i++) {
        var caId = regionData[i].properties.id;
        formattedRegions[i] = populateNewRegion(metadata[caId], 1, false);
        for (var j = 0; j < regionData[i].geometry.coordinates[0].length; j++) {
          formattedRegions[i].points[j] = getLatLong(regionData[i].geometry.coordinates[0][j], digits);
        }
    }
    return formattedRegions;
}


function processNACRegions(input, digits) {
    winston.info('processNACRegions: initiated');
    var data = JSON.parse(input);
    var regionData = data.features;
    var formattedRegions = [];
    var row = 0;
    var polygons = 1;
    for (var i = 0; i < regionData.length; i++) {
        polygons = regionData[i].geometry.coordinates.length;
        for (var j = 0; j < polygons; j++) {
            formattedRegions[row] = populateNewRegion(regionData[i], j, true);
            if (regionData[i].geometry.type === regions.DATA_MULTIPOLYGON_TYPE) {
                for (var k = 0; k < regionData[i].geometry.coordinates[j][0].length; k++) {
                    formattedRegions[row].points[k] = getLatLong(regionData[i].geometry.coordinates[j][0][k], digits);
                }
            } else {
                for (var k = 0; k < regionData[i].geometry.coordinates[j].length; k++) {
                    formattedRegions[row].points[k] = getLatLong(regionData[i].geometry.coordinates[j][k], digits);
                }
            }
            row++;
        }
    }
    return formattedRegions;
}

function populateNewRegion(regionData, regionCount, isNacData) {
    var region = {};
    if (isNacData == true) {
        region.regionId = 'nac_' + regionData.id;
        if (regionData.geometry.coordinates.length > 1) {
            region.regionId += '_' + (regionCount+1);
        }
        region.displayName = regionData.properties.name;
        region.URL = regionData.properties.link;
        region.centerId = regionData.properties.center_id.toLowerCase();
    } else {
        region = regionData;
    }
    region.points = [];
    return region;
}

function getLatLong(coordinate, digits) {
    var lon = coordinate[0] = parseFloat(coordinate[0]).toFixed(digits);
    var lat = coordinate[1] = parseFloat(coordinate[1]).toFixed(digits);
    return {'lat': lat, 'lon': lon};
}