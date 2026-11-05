const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('./server');
const payload={applicant_name:'Example Applicant',organization:'',email:'client@example.com',phone:'+66 888 123 456',start_at:'2030-12-01T10:00',duration_hours:1,zones:['A'],event_title:'Test exhibition',event_type:'Exhibition',attendees:5,equipment:'',notes:'Exhibition use for gallery',accepted:true,website:''};
test('1 hour calculation and exact submission fields',()=>{const d=validate(payload);assert.equal(d.grandTotal,10922.92);assert.equal(d.rental,208.33);assert.equal(d.vat,714.58);assert.equal(d.recordStatus,'NEW');assert.equal(d.zones,'A');});
test('seven-day base',()=>{const d=validate({...payload,duration_hours:168});assert.equal(d.grandTotal,48150);assert.equal(d.difference7d,0);});
test('reject unapproved zones',()=>{assert.throws(()=>validate({...payload,zones:['Z']}));});
test('reject bad future date',()=>{assert.throws(()=>validate({...payload,start_at:'2020-01-01T10:00'}));});
test('reject forged price input: server recalculates',()=>{const d=validate({...payload,grandTotal:1,rental:1});assert.equal(d.grandTotal,10922.92);});
