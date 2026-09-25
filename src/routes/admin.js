const router = require('express').Router();
const { refreshBlocklists } = require('../analyzers/blocklistManager');

router.get('/refresh-blocklists', async (req, res) => {
  try {
    res.json({ ok: true, ...(await refreshBlocklists()), refreshedAt: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ error: 'Blocklist refresh unavailable' });
  }
});

module.exports = router;