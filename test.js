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

