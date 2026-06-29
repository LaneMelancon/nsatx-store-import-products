function logUserErrors(label, userErrors) {
	if (!userErrors?.length) return true;
	for (const err of userErrors) {
		console.log(`  ${label}: ${err.code ?? ''} ${err.message} (${(err.field ?? []).join('.')})`);
	}
	return false;
}

export { logUserErrors };
