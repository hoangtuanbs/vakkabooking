var AccountManager = require('./modules/accountmanager');
var EmailSender = require('./modules/emaildispatcher');

module.exports = function(app)
{

	/*
		login & logout
	*/

	app.get('/', function(req, res)
	{
		// check if the user has an auto login key saved in a cookie //
		if (req.cookies.login == undefined)
		{
			res.render('login', { title: 'Hello - Please Login To Your Account' });
		} else
		{
			// attempt automatic login //
			AccountManager.validateLoginKey(req.cookies.login, req.ip, function(e, o)
			{
				if (o)
				{
					AccountManager.autoLogin(o.email, o.pass, function(o)
					{
						req.session.user = o;
						res.redirect('/home');
					});
				} else
				{
					res.render('login', { title: 'Hello - Please Login To Your Account' });
				}
			});
		}
	});

	app.post('/', function(req, res)
	{
		AccountManager.manualLogin(req.body['email'], req.body['pass'], function(e, o)
		{
			if (!o)
			{
				res.status(400).send(e);
			} else
			{
				req.session.user = o;
				if (req.body['remember-me'] == 'false')
				{
					res.status(200).send(o);
				} else
				{
					AccountManager.generateLoginKey(o.user, req.ip, function(key)
					{
						res.cookie('login', key, { maxAge: 900000 });
						res.status(200).send(o);
					});
				}
			}
		});
	});

	app.post('/logout', function(req, res)
	{
		res.clearCookie('login');
		req.session.destroy(function(e){ res.status(200).send('ok'); });
	})

	/*
		control panel
	*/

	app.get('/home', function(req, res)
	{
		if (req.session.user == null)
		{
			res.redirect('/');
		} else
		{
			var weekdays = [];
			var bookings = [];
			var datenow = new Date();
			
			var convertTwodigit = function(number)
			{
				return (number < 10) ? "0" + number : "" + number;
			}
			
			var isBooked = function(map, time)
			{
				return map.hasOwnProperty(time);
			}
			
			var isDisable = function(map, time)
			{
				if (map.hasOwnProperty(time))
				{
					var bookitem = map[time];
					if (req.session.user._id == bookitem.userid)
					{
						return true;
					}
				}

				return false;
			}
			
			var convertDateToBookingTime = function(adate, i, j)
			{
				return adate.getFullYear()*1000000 + adate.getMonth()*10000 + (adate.getDate() - adate.getDay() + i)*100 + j;
			}
			
			var getFirstWord = function(str)
			{
				var spacePosition = str.indexOf(' ');
				if (spacePosition === -1)
					return str;
				else
					return str.substr(0, spacePosition);
			};
			
			var getBookedUser = function(map, time)
			{
				if (map.hasOwnProperty(time))
				{
					var bookitem = map[time];
					return bookitem.name;
				}
				
				return null;
			}
			
			var mixBooking = function(bookingArrays, bookingMap)
			{
				for (var i = 0; i < 7; i++)
				{
					var aday = {};
					var newarray = [];
					for (var j = 7; j < 24; j++)
					{
						var bookingobject = {};
						var time_text;
						if (j < 10) time_text = ("0" + j + ":00 AM");
						else if (j < 13) time_text = (j + ":00 AM");
						else time_text = (j + ":00 PM");

						var booking_time = convertDateToBookingTime(datenow, i, j);

						bookingobject['id'] = booking_time;
						var isbooked = isBooked(bookingMap, booking_time);
						var isdisable = isDisable(bookingMap, booking_time);
						var bookeduser = getBookedUser(bookingMap, booking_time);

						bookingobject['booked'] = isbooked;
						bookingobject['disable'] = isdisable;

						if (isbooked && !isdisable)
						{
							time_text += ("(" + getFirstWord(bookeduser) + ")");
						}
						bookingobject['time'] = time_text;
						newarray.push(bookingobject);
					}

					aday['booking'] = newarray;
					aday['date'] = ("" + convertTwodigit(datenow.getDate() - datenow.getDay() + i) +
							"-" + convertTwodigit(datenow.getMonth()) + 
							"-" + datenow.getFullYear());

					aday['today'] = (i == datenow.getDay()) ? true : false;

					weekdays.push(aday);
				}

				return weekdays;
			}

			AccountManager.getBookingsForWeek(datenow, function(e, o)
			{
				if (e || o == null)
				{
					res.redirect('/');
				} else
				{
					var bookingmap = {};
					o.forEach(function(item, index)
					{
						bookingmap[item.booking_time] = item;
					});
					
					weekdays = mixBooking(bookings, bookingmap);
					
					let pageinfo = {
						title : 'Vakka Booking',
						udata : req.session.user,
						weekdays: weekdays
					};
					
					res.render('home', pageinfo);
				}
			})
		}
	});

	app.post('/home', function(req, res)
	{
		if (req.session.user == null)
		{
			res.redirect('/');
		} else
		{
			AccountManager.updateAccount({
				id		: req.session.user._id,
				name	: req.body['name'],
				email	: req.body['email'],
				pass	: req.body['pass']
			}, function(e, o)
			{
				if (e)
				{
					res.status(400).send('error-updating-account');
				} else
				{
					req.session.user = o.value;
					res.status(200).send('ok');
				}
			});
		}
	});

	app.get('/account', function(req, res)
	{
		let pageinfo = {
			title : 'Account Settings',
			udata : req.session.user
		};
					
		res.render('accountpage', pageinfo);
	});
	
	/*
		new accounts
	*/
	
	app.get('/signup', function(req, res)
	{
		res.render('signup', {  title: 'Signup' });
	});

	app.post('/signup', function(req, res)
	{
		AccountManager.addNewAccount({
			name 	: req.body['name'],
			email 	: req.body['email'],
			pass	: req.body['pass']
		}, function(e)
		{
			if (e)
			{
				res.status(400).send(e);
			}else
			{
				res.status(200).send('ok');
			}
		});
	});

	/*
		password reset
	*/

	app.post('/lost-password', function(req, res)
	{
		let email = req.body['email'];
		AccountManager.generatePasswordKey(email, req.ip, function(e, account)
		{
			if (e)
			{
				res.status(400).send(e);
			} else
			{
				EmailSender.dispatchResetPasswordLink(account, function(e, m)
				{
				// TODO this callback takes a moment to return, add a loader to give user feedback //
					if (!e)
					{
						res.status(200).send('ok');
					} else
					{
						for (k in e) console.log('ERROR : ', k, e[k]);
						res.status(400).send('unable to dispatch password reset');
					}
				});
			}
		});
	});

	app.get('/reset-password', function(req, res)
	{
		AccountManager.validatePasswordKey(req.query['key'], req.ip, function(e, o)
		{
			if (e || o == null)
			{
				res.redirect('/');
			} else
			{
				req.session.passKey = req.query['key'];
				res.render('reset', { title : 'Reset Password' });
			}
		})
	});

	app.post('/reset-password', function(req, res)
	{
		let oldPass = req.body['oldpass'];
		let repeatPass = req.body['repeatpass'];
		let newPass = req.body['pass'];
		let passKey = req.session.passKey;
		
		if (newPass != repeatPass)
		{
			res.status(400).send('Repeat password do not match.');
		}
		// destory the session immediately after retrieving the stored passkey //
		req.session.destroy();
		
		AccountManager.updatePassword(passKey, oldPass, newPass, function(e, o)
		{
			if (o)
			{
				res.status(200).send('ok');
			} else
			{
				res.status(400).send('Unable to update password');
			}
		})
	});
	
	/*
		view, delete & reset accounts
	*/

	app.get('/print', function(req, res)
	{
		AccountManager.getAllRecords( function(e, accounts)
		{
			res.render('print', { title : 'Account List', accts : accounts });
		})
	});

	app.post('/delete', function(req, res)
	{
		AccountManager.deleteAccount(req.session.user._id, function(e, obj)
		{
			if (!e)
			{
				res.clearCookie('login');
				req.session.destroy(function(e){ res.status(200).send('ok'); });
			} else
			{
				res.status(400).send('record not found');
			}
		});
	});

	/*app.get('/reset', function(req, res)
	{
		AccountManager.deleteAllAccounts(function()
		{
			res.redirect('/print');
		});
	});*/

	app.post('/booking', function(req, res)
	{
		AccountManager.addBookingForUser(
		{
			userid 			: req.session.user._id,
			booking_time 	: req.body['booking_time']
		}, function(e)
		{
			if (e)
			{
				res.status(400).send(e);
			} else
			{
				res.status(200).send('ok');
			}
		});
	});
	
	app.get('*', function(req, res) { res.render('404', { title: 'Page Not Found'}); });
};
