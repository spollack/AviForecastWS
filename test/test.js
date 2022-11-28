//
// required packages
//
var should = require('should');
var winston = require('winston');
var fs = require('fs');
var moment = require('moment');
var forecasts = require('../forecasts.js');


// set up the logger
winston.remove(winston.transports.Console);
// verbose, info, warn, error are the log levels we're using
winston.add(winston.transports.Console, {level: 'error', handleExceptions: true});


describe('aviLevelFromName', function(){
    describe('matching strings', function(){
        it('should return the correct avi Level', function(){
            forecasts.aviLevelFromName('low').should.equal(1);
            forecasts.aviLevelFromName('moderate').should.equal(2);
            forecasts.aviLevelFromName('considerable').should.equal(3);
            forecasts.aviLevelFromName('high').should.equal(4);
            forecasts.aviLevelFromName('extreme').should.equal(5);
            forecasts.aviLevelFromName('Low').should.equal(1);
            forecasts.aviLevelFromName('lOW').should.equal(1);
            forecasts.aviLevelFromName(' low').should.equal(1);
            forecasts.aviLevelFromName('low ').should.equal(1);
            forecasts.aviLevelFromName(' low ').should.equal(1);
            forecasts.aviLevelFromName('   lOw ').should.equal(1);
        })
    })
    describe('non-matching strings', function(){
        it('should return 0', function(){
            forecasts.aviLevelFromName('foo').should.equal(0);
            forecasts.aviLevelFromName('lower').should.equal(0);
            forecasts.aviLevelFromName('no-data').should.equal(0);
            forecasts.aviLevelFromName('').should.equal(0);
            forecasts.aviLevelFromName(null).should.equal(0);
        })
    })
})

describe('findHighestAviLevelInString', function(){
    describe('matching strings', function(){
        it('should return the correct avi Level', function(){
            forecasts.findHighestAviLevelInString('low').should.equal(1);
            forecasts.findHighestAviLevelInString('moderate').should.equal(2);
            forecasts.findHighestAviLevelInString('considerable').should.equal(3);
            forecasts.findHighestAviLevelInString('high').should.equal(4);
            forecasts.findHighestAviLevelInString('extreme').should.equal(5);
            forecasts.findHighestAviLevelInString('Low').should.equal(1);
            forecasts.findHighestAviLevelInString('lOW').should.equal(1);
            forecasts.findHighestAviLevelInString(' low').should.equal(1);
            forecasts.findHighestAviLevelInString('low ').should.equal(1);
            forecasts.findHighestAviLevelInString(' low ').should.equal(1);
            forecasts.findHighestAviLevelInString('   lOw ').should.equal(1);
        })
    })
    describe('non-matching strings', function(){
        it('should return 0', function(){
            forecasts.findHighestAviLevelInString('foo').should.equal(0);
            forecasts.findHighestAviLevelInString('lower').should.equal(0);
            forecasts.findHighestAviLevelInString('lowhigh').should.equal(0);
            forecasts.findHighestAviLevelInString('').should.equal(0);
            forecasts.findHighestAviLevelInString(null).should.equal(0);
        })
    })
    describe('multiple matching strings', function(){
        it('should return the highest level', function(){
            forecasts.findHighestAviLevelInString('low high').should.equal(4);
            forecasts.findHighestAviLevelInString(' low high   ').should.equal(4);
            forecasts.findHighestAviLevelInString('high low').should.equal(4);
            forecasts.findHighestAviLevelInString('low low').should.equal(1);
            forecasts.findHighestAviLevelInString('low high low').should.equal(4);
            forecasts.findHighestAviLevelInString('low highways').should.equal(1);
        })
    })
})

describe('getRegionDetailsForRegionId', function(){
    describe('matching strings', function(){
        it('should return the correct region details', function(){
            forecasts.getRegionDetailsForRegionId('nwac_139').should.have.property('provider','nwac');
            forecasts.getRegionDetailsForRegionId('cac_1').should.have.property('provider','cac');
            forecasts.getRegionDetailsForRegionId('pc_1').should.have.property('provider','pc');
            forecasts.getRegionDetailsForRegionId('caic_1b').should.have.property('provider','caic');
        })
    })
    describe('non-matching strings', function(){
        it('should return null', function(){
            should.not.exist(forecasts.getRegionDetailsForRegionId('foo'));
            should.not.exist(forecasts.getRegionDetailsForRegionId('foo_bar'));
            should.not.exist(forecasts.getRegionDetailsForRegionId(''));
            should.not.exist(forecasts.getRegionDetailsForRegionId(null));
            should.not.exist(forecasts.getRegionDetailsForRegionId('caic_0123456'));
        })
    })
})

describe('validateForecast', function(){
    describe('null forecasts', function(){
        it('should return false, unless it is a known exception region', function(){
            forecasts.validateForecast('nwac_139', null).should.be.false;
        })
    })
    describe('valid forecasts', function(){
        it('should return true', function(){
            forecasts.validateForecast('cac_sea-to-sky',
                forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file002.json','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_sea-to-sky')), false).should.be.true;

            forecasts.validateForecast('caic_8',
                forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_8')), false).should.be.true;
        })
    })
    describe('forecasts with bad dates', function(){
        it('should return false', function(){
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-03', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-01', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2011-12-31', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:1},{date:'2012-01-04', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:1},{date:'2012-01-01', aviLevel:1}], false).should.be.false;
        })
    })
    describe('forecasts with bad aviLevels', function(){
        it('should return false', function(){
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:0}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:0},{date:'2012-01-02', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:4},{date:'2012-01-02', aviLevel:1},{date:'2012-01-03', aviLevel:0}], false).should.be.false;
        })
    })
})

describe('validateForecastForCurrentDay', function(){
    describe('current date is not represented', function(){
        it('should return false', function(){
            forecasts.validateForecastForCurrentDay('nwac_139', [{date:'2012-01-01', aviLevel:2},{date:'2012-01-02', aviLevel:3}]).should.be.false;
        })
    })
    describe('current date is not represented', function(){
        it('should return true', function(){
            // NOTE this is run using current local time...
            forecasts.validateForecastForCurrentDay('nwac_139',
                [{date:moment().format('YYYY-MM-DD'), aviLevel:2},{date:moment().add(1, 'days').format('YYYY-MM-DD'), aviLevel:3}]).should.be.true;
        })
    })
})

describe('parseForecast_avalanche_org_api nwac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/nwac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_419'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2021-12-12');
            forecast[0].aviLevel.should.equal(3);
            forecast[1].date.should.equal('2021-12-13');
            forecast[1].aviLevel.should.equal(3);
        })
    })
})