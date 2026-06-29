/** Normalize a label for fuzzy matching: lowercase, collapse hyphens/underscores/slashes to spaces, trim whitespace. */
function normalizeKey(s) {
	return s
		.toLowerCase()
		.replace(/[-_/]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Find a [key, id] entry in a name->GID map using normalized matching. Throws if not found. */
function lookupEntry(map, name, label) {
	const target = normalizeKey(name);
	for (const entry of Object.entries(map)) {
		if (normalizeKey(entry[0]) === target) return entry;
	}
	throw new Error(`No ${label ?? 'entry'} found for "${name}" (normalized: "${target}")`);
}

/** Look up a GID in a name->GID map using normalized matching. Throws if not found. */
function lookupId(map, name, label) {
	return lookupEntry(map, name, label)[1];
}

export { normalizeKey, lookupId, lookupEntry };
