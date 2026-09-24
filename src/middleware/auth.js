const crypto = require('crypto');

module.exports = (req, res, next) => {
	const configured = process.env.API_KEY;
	const provided = req.headers['x-api-key'];
	if (!configured || !provided) return res.status(401).json({ error: 'Unauthorized' });
	const expected = Buffer.from(configured);
	const actual = Buffer.from(String(provided));
	if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return res.status(401).json({ error: 'Unauthorized' });
	next();
};
