const fs = require('fs');
const forecasts = require('./forecasts.js');

const regions = JSON.parse(fs.readFileSync(forecasts.REGIONS_PATH, 'utf8'));
forecasts.aggregateForecasts(regions);
