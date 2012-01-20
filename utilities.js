//
// required packages
//

var fs = require('fs');


//KMLFileToJSONFile('nwac_regions.kml','nwac_regions.json','nwac');
KMLFileToJSONFile('canada_regions.kml','canada_regions.json','canada');


function KMLFileToJSONFile(KMLFileName, JSONFileName, regionPrefix) {
    var JSONString = KMLStringToJSONString(fs.readFileSync(KMLFileName, 'utf8'), regionPrefix);
    if (JSONString) {
        fs.writeFileSync(JSONFileName, JSONString, 'utf8');
    }
}

function KMLStringToJSONString(KML, regionPrefix) {

    var JSONString = null;

    // grab all the placemarks from the KML
    var placemarkBlocks = KML.match(/<Placemark>[\S\s]*?<\/Placemark>/g);
    if (placemarkBlocks) {

        var data = [placemarkBlocks.length];

        for (var i = 0; i < placemarkBlocks.length; i++) {
            //console.log('placemarkBlocks[' + i + ']: ' + placemarkBlocks[i]);

            // for each placemark, grab the data we need

            var nameMatch = placemarkBlocks[i].match(/<name>([\S\s]*?)<\/name>/);
            var name = (nameMatch && nameMatch.length > 1) ? nameMatch[1] : 'TBD';
            //console.log('name: ' + name);

            var oneBasedIndex = i + 1;
            data[i] = {'regionId': regionPrefix + '_' + oneBasedIndex, 'displayName': name, 'points':[]};

            var coordinatesMatch = placemarkBlocks[i].match(/<coordinates>\s*([\S\s]*?)\s*<\/coordinates>/);
            var coordinatesList = (coordinatesMatch && coordinatesMatch.length > 1) ? coordinatesMatch[1] : '';
            //console.log('coordinatesList: ' + coordinatesList);

            var coordinates = coordinatesList.match(/\s*(\S+)\s*/g);
            if (coordinates) {
                for (var j = 0; j < coordinates.length; j++) {
                    //console.log('coordinates[' + j + ']: ' + coordinates[j]);

                    var components = coordinates[j].match(/[-+]?[0-9]*\.[0-9]*/g);
                    if (components && components.length >= 2) {
                        var lat = components[0];
                        var lon = components[1];
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
