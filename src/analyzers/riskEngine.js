const { riskLevel, recommendation } = require('./thresholds');

function calculateRisk(profile = {}, username = {}, behavior = {}, network = {}, alt = {}, join = {}, guildOrFlags = {}, flagsMaybe = {}) {
	let guildBaseline = {};
	let flags = flagsMaybe;
	if (guildOrFlags && ('isFlagged' in guildOrFlags || 'sameIpAsBanned' in guildOrFlags || 'altOfBanned' in guildOrFlags)) {
		flags = guildOrFlags;
		guildBaseline = {};
	} else {
		guildBaseline = guildOrFlags || {};
		if (!flagsMaybe || Object.keys(flagsMaybe).length === 0) flags = {};
	}
	const weights = { profile: 0.9, username: 0.5, behavior: 0.9, network: 0.8, alt: 0.8, join: 0.5, guildBaseline: 0.4 };
	const values = [
		[profile.score, weights.profile],
		[username.score, weights.username],
		[behavior.score, weights.behavior],
		[network.score, weights.network],
		[alt.totalAltScore ?? alt.score, weights.alt],
		[join.score, weights.join],
		[guildBaseline.score, weights.guildBaseline]
	];
	let probability = 1;
	for (const [score, weight] of values) probability *= 1 - ((Math.max(0, Math.min(100, Number(score) || 0)) / 100) * weight);
	let p = 1 - probability;
	const forcedBlock = Boolean(flags.isFlagged || flags.sameIpAsBanned || flags.altOfBanned);
	const networkReasons = network.reasons || [];
	const altReasons = (alt.alts || []).flatMap(a => a.reasons || []);
	const joinReasons = join.reasons || [];
	const redFlag = networkReasons.length > 0 || altReasons.length > 0 || joinReasons.length > 0;
	let finalScore = forcedBlock ? 100 : Math.max(0, Math.min(100, Math.round(100 * p)));
	if (!forcedBlock && !redFlag) finalScore = Math.max(0, finalScore - (Number(profile.richness) || 0));
	const level = riskLevel(finalScore);
	let action = recommendation(finalScore);
	const reasons = [
		...(profile.reasons || []),
		...(username.reasons || []),
		...(behavior.reasons || []),
		...(network.reasons || []),
		...((alt.alts || []).flatMap(a => a.reasons || [])),
		...(join.reasons || []),
		...(guildBaseline.reasons || [])
	];
	if (forcedBlock) { action = 'block'; reasons.push('INSTANT_CRITICAL_OVERRIDE'); }
	const signalCount = [profile, username, behavior, network, alt, join, guildBaseline].filter(signal => Number(signal.score || signal.totalAltScore || 0) > 0 || (signal.reasons || []).some(reason => reason !== 'ACCOUNT_AGE_UNKNOWN') || (signal.alts || []).length > 0).length;
	return {
		finalScore,
		riskLevel: level,
		recommendation: action,
		confidence: signalCount >= 4 ? 'high' : signalCount >= 2 ? 'medium' : 'low',
		signalCount,
		breakdown: { profile, username, behavior, network, alts: alt, joinPattern: { ...join, guildBaseline }, guildBaseline },
		reasons: [...new Set(reasons)]
	};
}
module.exports={calculateRisk};
