/** Retry a GraphQL call with exponential backoff if Shopify responds with a THROTTLED cost error. */
async function withRetry(fn, { retries = 5, baseDelayMs = 1000 } = {}) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const isThrottled = /THROTTLED/.test(err.message);
			if (!isThrottled || attempt >= retries) throw err;
			const delay = baseDelayMs * 2 ** attempt;
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}

export { withRetry };
