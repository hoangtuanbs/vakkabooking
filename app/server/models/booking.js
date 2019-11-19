
// Dependencies
var restful = require('node-restful');
var mongoose = restful.mongoose;

// Schema
var bookingSchema = new mongoose.Schema({
  date: Date,
  name: String,
  email: String,
  status: Boolean
});

// Return model
module.exports = restful.model('Booking', bookingSchema);