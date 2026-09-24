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
	const riskLevel = finalScore <= 25 ? 'clean' : finalScore <= 50 ? 'low' : finalScore <= 75 ? 'high' : 'critical';
	const recommendation = finalScore <= 25 ? 'allow' : finalScore <= 50 ? 'monitor' : finalScore <= 75 ? 'challenge' : finalScore <= 90 ? 'queue' : 'block';
	const reasons = [
		...(profile.reasons || []),
		...(username.reasons || []),
		...(behavior.reasons || []),
		...(network.reasons || []),
		...((alt.alts || []).flatMap(a => a.reasons || [])),
		...(join.reasons || [])
	];
	if (forcedBlock) reasons.push('INSTANT_CRITICAL_OVERRIDE');
	return {
		finalScore,
		riskLevel,
		recommendation,
		breakdown: { profile, username, behavior, network, alts: alt, joinPattern: join },
		reasons: [...new Set(reasons)]
	};
}
module.exports={calculateRisk};
