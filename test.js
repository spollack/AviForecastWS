var should = require('should');
var aviws = require('./main.js');

describe('aviLevelFromName', function(){
    describe('matching strings', function(){
        it('should return the correct avi Level', function(){
            aviws.aviLevelFromName('low').should.equal(1);
            aviws.aviLevelFromName('moderate').should.equal(2);
            aviws.aviLevelFromName('considerable').should.equal(3);
            aviws.aviLevelFromName('high').should.equal(4);
            aviws.aviLevelFromName('extreme').should.equal(5);
            aviws.aviLevelFromName('Low').should.equal(1);
            aviws.aviLevelFromName('lOW').should.equal(1);
            aviws.aviLevelFromName(' low').should.equal(1);
            aviws.aviLevelFromName('low ').should.equal(1);
            aviws.aviLevelFromName(' low ').should.equal(1);
            aviws.aviLevelFromName('   lOw ').should.equal(1);
        })
    })
    describe('non-matching strings', function(){
        it('should return 0', function(){
            aviws.aviLevelFromName('foo').should.equal(0);
            aviws.aviLevelFromName('lower').should.equal(0);
            aviws.aviLevelFromName('').should.equal(0);
            aviws.aviLevelFromName(null).should.equal(0);
        })
    })
})

describe('findAviLevelInString', function(){
    describe('matching strings', function(){
        it('should return the correct avi Level', function(){
            aviws.findHighestAviLevelInString('low').should.equal(1);
            aviws.findHighestAviLevelInString('moderate').should.equal(2);
            aviws.findHighestAviLevelInString('considerable').should.equal(3);
            aviws.findHighestAviLevelInString('high').should.equal(4);
            aviws.findHighestAviLevelInString('extreme').should.equal(5);
            aviws.findHighestAviLevelInString('Low').should.equal(1);
            aviws.findHighestAviLevelInString('lOW').should.equal(1);
            aviws.findHighestAviLevelInString(' low').should.equal(1);
            aviws.findHighestAviLevelInString('low ').should.equal(1);
            aviws.findHighestAviLevelInString(' low ').should.equal(1);
            aviws.findHighestAviLevelInString('   lOw ').should.equal(1);
        })
    })
    describe('non-matching strings', function(){
        it('should return 0', function(){
            aviws.findHighestAviLevelInString('foo').should.equal(0);
            aviws.findHighestAviLevelInString('lower').should.equal(0);
            aviws.findHighestAviLevelInString('lowhigh').should.equal(0);
            aviws.findHighestAviLevelInString('').should.equal(0);
            aviws.findHighestAviLevelInString(null).should.equal(0);
        })
    })
    describe('multiple matching strings', function(){
        it('should return the highest level', function(){
            aviws.findHighestAviLevelInString('low high').should.equal(4);
            aviws.findHighestAviLevelInString(' low high   ').should.equal(4);
            aviws.findHighestAviLevelInString('high low').should.equal(4);
            aviws.findHighestAviLevelInString('low low').should.equal(1);
            aviws.findHighestAviLevelInString('low high low').should.equal(4);
            aviws.findHighestAviLevelInString('low highways').should.equal(1);
        })
    })
})


















