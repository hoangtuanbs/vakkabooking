
const crypto 		= require('crypto');
const moment 		= require('moment');
const MongoClient 	= require('mongodb').MongoClient;

var Database, Accounts, Bookings;

MongoClient.connect(process.env.DB_URL, { useNewUrlParser: true }, function(e, client)
{
	if (e)
	{
		console.log(e);
	} else
	{
		Database = client.db(process.env.DB_NAME);
		Accounts = Database.collection('accounts');
		// index fields 'user' & 'email' for faster new account validation //
		Accounts.createIndex({email: 1});
		
		Bookings = Database.collection('bookings');
		// index fields 'user' & 'email' for faster new account validation //
		Bookings.createIndex({booking_time: 1});
		
		console.log('mongo :: connected to database :: "' + process.env.DB_NAME + '"');
	}
});

const guid = function(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {var r = Math.random()*16|0,v=c=='x'?r:r&0x3|0x8;return v.toString(16);});}

/*
	login validation methods
*/

exports.autoLogin = function(email, pass, callback)
{
	Accounts.findOne({email:email}, function(e, o)
	{
		if (o)
		{
			o.pass == pass ? callback(o) : callback(null);
		} else
		{
			callback(null);
		}
	});
}

exports.manualLogin = function(email, pass, callback)
{
	Accounts.findOne({email:email}, function(e, o)
	{
		if (o == null)
		{
			callback('user-not-found');
		} else
		{
			validatePassword(pass, o.pass, function(err, res)
			{
				if (res)
				{
					callback(null, o);
				} else
				{
					callback('invalid-password');
				}
			});
		}
	});
}

exports.generateLoginKey = function(email, ipAddress, callback)
{
	let cookie = guid();
	
	Accounts.findOneAndUpdate({email:email}, {$set:{
		ip : ipAddress,
		cookie : cookie
	}}, {returnOriginal : false}, function(e, o)
	{ 
		callback(cookie);
	});
}

exports.validateLoginKey = function(cookie, ipAddress, callback)
{
// ensure the cookie maps to the user's last recorded ip address //
	Accounts.findOne({cookie:cookie, ip:ipAddress}, callback);
}

exports.generatePasswordKey = function(email, ipAddress, callback)
{
	let passKey = guid();
	Accounts.findOneAndUpdate({email:email}, {$set:{
		ip : ipAddress,
		passKey : passKey
	}, $unset:{cookie:''}}, {returnOriginal : false}, function(e, o)
	{
		if (o.value != null)
		{
			callback(null, o.value);
		} else
		{
			callback(e || 'account not found');
		}
	});
}

exports.validatePasswordKey = function(passKey, ipAddress, callback)
{
	// ensure the passKey maps to the user's last recorded ip address //
	Accounts.findOne({passKey:passKey, ip:ipAddress}, callback);
}

/*
	record insertion, update & deletion methods
*/

exports.addNewAccount = function(newData, callback)
{
	Accounts.findOne({email:newData.email}, function(e, o)
	{
		if (o)
		{
			callback('email-taken');
		} else
		{
			saltAndHash(newData.pass, function(hash)
			{
				newData.pass = hash;
				// append date stamp when record was created //
				newData.date = moment().format('MMMM Do YYYY, h:mm:ss a');
				Accounts.insertOne(newData, callback);
			});
		}
	});
}

exports.updateAccount = function(newData, callback)
{
	let findOneAndUpdate = function(data)
	{
		var o = {
			name : data.name,
			email : data.email
		}
		if (data.pass) o.pass = data.pass;
		Accounts.findOneAndUpdate({_id:getObjectId(data.id)}, {$set:o}, {returnOriginal : false}, callback);
	}
	
	if (newData.pass == '')
	{
		findOneAndUpdate(newData);
	}	else 
	{ 
		saltAndHash(newData.pass, function(hash)
		{
			newData.pass = hash;
			findOneAndUpdate(newData);
		});
	}
}

exports.updatePassword = function(passKey, oldPass, newPass, callback)
{
	saltAndHash(oldPass, function(oldhash)
	{
		oldPass = oldhash;
		
		saltAndHash(newPass, function(hash)
		{
			newPass = hash;
			Accounts.findOneAndUpdate({passKey:passKey,pass:oldPass}, {$set:{pass:newPass}, $unset:{passKey:''}},
					{returnOriginal : false}, callback);
		});
	}
}

/*
	account lookup methods
*/

exports.getAllRecords = function(callback)
{
	Accounts.find().toArray(
		function(e, res) 
		{
			if (e) callback(e)
			else callback(null, res)
		}
	);
}

exports.deleteAccount = function(id, callback)
{
	Accounts.deleteOne({_id: getObjectId(id)}, callback);
}

exports.deleteAllAccounts = function(callback)
{
	Accounts.deleteMany({}, callback);
}

exports.addBookingForUser = function(bookingrequest, callback)
{
	Accounts.findOne({_id:getObjectId(bookingrequest.userid)}, function(e, o)
	{
		var userid = bookingrequest.userid;
		var name = o.name;
		var booking_time = parseInt(bookingrequest.booking_time);
		var time = new Date();
		
		Bookings.findOne({booking_time: booking_time}, function(e, o)
		{
			if (o)
			{
				if (o.userid == bookingrequest.userid)
				{
					Bookings.deleteOne(o, callback);
				} else 
				{
					callback('booking-taken');
				}
			} else
			{
				var newbooking = {}; 
				newbooking.date = time;
				newbooking.booking_time = booking_time;
				newbooking.name = name;
				newbooking.userid = userid;
	
				Bookings.insertOne(newbooking, callback);
			}
		});
	});
}

exports.getBookingsForWeek = function(date, callback)
{
	var lowrange = getLowRangeForWeekSearch(date);
	var uprange = getUpperRangeForWeekSearch(date);
	
	Bookings.find(
	{ 
		booking_time : { $gt :  lowrange, $lt : uprange}
	}).toArray(
		function(e, res) 
		{
			if (e) callback(e)
			else 
			{
				callback(null, res);
			}
		}
	);;
}

exports.deleteBooking = function(email, date, callback)
{
	var booking_time = convertDateToBookingTime(date);
	
	Bookings.findOne({booking_time: booking_time}, function(e, o)
	{
		if (o == null)
		{
			callback('booking-not-found');
		} else if (o.email != email)
		{
			callback('invalid-user');
		} else
		{
			Accounts.deleteOne(o, callback);
		}
	});
}

/*
	private encryption & validation methods
*/

var generateSalt = function()
{
	var set = '0123456789abcdefghijklmnopqurstuvwxyzABCDEFGHIJKLMNOPQURSTUVWXYZ';
	var salt = '';
	
	for (var i = 0; i < 10; i++)
	{
		var p = Math.floor(Math.random() * set.length);
		salt += set[p];
	}
	return salt;
}

var md5 = function(str)
{
	return crypto.createHash('md5').update(str).digest('hex');
}

var saltAndHash = function(pass, callback)
{
	var salt = generateSalt();
	callback(salt + md5(pass + salt));
}

var validatePassword = function(plainPass, hashedPass, callback)
{
	var salt = hashedPass.substr(0, 10);
	var validHash = salt + md5(plainPass + salt);
	callback(null, hashedPass === validHash);
}

var getObjectId = function(id)
{
	return new require('mongodb').ObjectID(id);
}

var listIndexes = function()
{
	Accounts.indexes(null, function(e, indexes)
	{
		for (var i = 0; i < indexes.length; i++) console.log('index:', i, indexes[i]);
	});
}

var convertDateToBookingTime = function(adate)
{
	return adate.getFullYear()*1000000 + adate.getMonth()*10000 + adate.getDate()*100 + adate.getHours();
}

var getLowRangeForWeekSearch = function(adate)
{
	return adate.getFullYear()*1000000 + adate.getMonth()*10000 + (adate.getDate() - adate.getDay()) *100;
}

var getUpperRangeForWeekSearch = function(adate)
{
	return adate.getFullYear()*1000000 + adate.getMonth()*10000 + (adate.getDate() - adate.getDay() + 7) *100;
}
