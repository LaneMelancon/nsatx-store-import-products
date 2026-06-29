function stripHtml(html) {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

function truncate(str, max) {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 1).trimEnd()}…`;
}

/** Alt text for a product's primary image: title + first sentence of the description, SEO-friendly. */
function productImageAlt(title, description) {
	const text = stripHtml(description);
	const firstSentence = (text.match(/^.*?[.!?](?=\s|$)/) ?? [text])[0];
	return truncate(`${title} – ${firstSentence}`, 125);
}

/** Alt text for a variant image: the variant's descriptive title, falling back to the product title. */
function variantImageAlt(productTitle, variantTitle) {
	const base = variantTitle && variantTitle.trim() ? variantTitle.trim() : productTitle;
	return truncate(base, 125);
}

export { productImageAlt, variantImageAlt };
