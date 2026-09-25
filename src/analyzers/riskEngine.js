const { riskLevel, recommendation } = require('./thresholds');

function calculateRisk(profile = {}, username = {}, behavior = {}, network = {}, alt = {}, join = {}, flags = {}) {
	const weighted = Math.round(
		(Number(profile.score) || 0) * 0.28 +
		(Number(username.score) || 0) * 0.18 +
		(Number(behavior.score) || 0) * 0.23 +
		(Number(network.score) || 0) * 0.14 +
		(Number(alt.totalAltScore ?? alt.score) || 0) * 0.10 +
		(Number(join.score) || 0) * 0.07
	);
	const forcedBlock = Boolean(flags.isFlagged || flags.sameIpAsBanned || flags.altOfBanned);
	const finalScore = forcedBlock ? 100 : Math.max(0, Math.min(100, weighted));
	const level = riskLevel(finalScore);
	let action = recommendation(finalScore);
	const reasons = [
		...(profile.reasons || []),
		...(username.reasons || []),
		...(behavior.reasons || []),
		...(network.reasons || []),
		...((alt.alts || []).flatMap(a => a.reasons || [])),
		...(join.reasons || [])
	];
	if (forcedBlock) { action = 'block'; reasons.push('INSTANT_CRITICAL_OVERRIDE'); }
	const signalCount = [profile, username, behavior, network, alt, join].filter(signal => Number(signal.score || signal.totalAltScore || 0) > 0 || (signal.reasons || []).some(reason => reason !== 'ACCOUNT_AGE_UNKNOWN') || (signal.alts || []).length > 0).length;
	return {
		finalScore,
		riskLevel: level,
		recommendation: action,
		confidence: signalCount >= 4 ? 'high' : signalCount >= 2 ? 'medium' : 'low',
		signalCount,
		breakdown: { profile, username, behavior, network, alts: alt, joinPattern: join },
		reasons: [...new Set(reasons)]
	};
}
module.exports={calculateRisk};
