//
// required packages
//
var fs = require('fs');


KMLFileToJSONFile('btac/JHAFC_Zones.kml','btac/btac.json','btac','http://jhavalanche.org/viewOther?area=');
// KMLFileToJSONFile('gnfac/GNFAC.kml','gnfac/gnfac.json','gnfac','http://www.mtavalanche.com/current');
// KMLFileToJSONFile('snfac/Advisory Region Map 2011 - zones.kml','snfac/snfac.json','snfac','http://www.sawtoothavalanche.com/adv_current.php');
// KMLFileToJSONFile('sac/SACForecastArea.kml','sac/sac.json','sac','http://www.sierraavalanchecenter.org/advisory');
// KMLFileToJSONFile('uac/uac.kml','uac/uac.json','uac','http://utahavalanchecenter.org/advisory/');
// KMLFileToJSONFile('nwac/nwac_regions.kml','nwac/nwac_regions.json','nwac','http://www.nwac.us/forecast/avalanche/current/zone/');
// KMLFileToJSONFile('Canada_all/canada_regions_simplified.kml','Canada_all/canada_regions_simplified.json','canada','');


function KMLFileToJSONFile(KMLFileName, JSONFileName, regionPrefix, URLPrefix) {
    var JSONString = KMLStringToJSONString(fs.readFileSync(KMLFileName, 'utf8'), regionPrefix, URLPrefix);
    if (JSONString) {
        fs.writeFileSync(JSONFileName, JSONString, 'utf8');
    }
}

function KMLStringToJSONString(KML, regionPrefix, URLPrefix) {

    var JSONString = null;

    // grab all the placemarks from the KML
    var placemarkBlocks = KML.match(/<Placemark[^>]*>[\S\s]*?<\/Placemark>/g);
    if (placemarkBlocks) {

        var data = [placemarkBlocks.length];

        for (var i = 0; i < placemarkBlocks.length; i++) {
            //console.log('placemarkBlocks[' + i + ']: ' + placemarkBlocks[i]);

            // for each placemark, grab the data we need

            var nameMatch = placemarkBlocks[i].match(/<name>([\S\s]*?)<\/name>/);
            var name = (nameMatch && nameMatch.length > 1) ? nameMatch[1] : 'TBD';
            //console.log('name: ' + name);

            var oneBasedIndex = i + 1;
            data[i] = {'regionId': regionPrefix + '_' + oneBasedIndex, 'displayName': name, 'URL' : URLPrefix, 'points':[]};

            var coordinatesMatch = placemarkBlocks[i].match(/<coordinates>\s*([\S\s]*?)\s*<\/coordinates>/);
            var coordinatesList = (coordinatesMatch && coordinatesMatch.length > 1) ? coordinatesMatch[1] : '';
            //console.log('coordinatesList: ' + coordinatesList);

            var coordinates = coordinatesList.match(/\s*(\S+)\s*/g);
            if (coordinates) {
                for (var j = 0; j < coordinates.length; j++) {
                    //console.log('coordinates[' + j + ']: ' + coordinates[j]);

                    var components = coordinates[j].match(/[-+]?[0-9]*\.[0-9]*/g);
                    if (components && components.length >= 2) {
                        // NOTE latitude comes after longitude in KML ... weird
                        var lat = components[1];
                        var lon = components[0];
                        //console.log('lat: ' + lat + '; lon: ' + lon);

                        data[i].points[j] = {'lat': lat, 'lon': lon};
                    }
                }
            }
        }

        JSONString = JSON.stringify(data, null, 4);
        //console.log(JSONString);
    }

    return JSONString;
}
