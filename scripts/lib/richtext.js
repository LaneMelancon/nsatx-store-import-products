/**
 * Convert the simple HTML used in the products sheet (h4/p/ul/li/a only, no nesting)
 * into Shopify's rich_text_field JSON schema: { type: "root", children: [...] }.
 */

function decodeEntities(str) {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

/** Parse inline content (text + <a href="...">...</a>) into rich text inline nodes. */
function parseInline(html) {
	const nodes = [];
	const linkRe = /<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gis;
	let lastIndex = 0;
	let m;
	while ((m = linkRe.exec(html))) {
		if (m.index > lastIndex) {
			const text = decodeEntities(html.slice(lastIndex, m.index));
			if (text) nodes.push({ type: 'text', value: text });
		}
		nodes.push({
			type: 'link',
			url: m[1],
			children: [{ type: 'text', value: decodeEntities(m[2]) }],
		});
		lastIndex = linkRe.lastIndex;
	}
	if (lastIndex < html.length) {
		const text = decodeEntities(html.slice(lastIndex));
		if (text) nodes.push({ type: 'text', value: text });
	}
	if (nodes.length === 0) nodes.push({ type: 'text', value: '' });
	return nodes;
}

/** Convert HTML (h4/p/ul>li blocks) to a Shopify rich_text_field JSON object. */
function htmlToRichText(html) {
	const children = [];
	const blockRe = /<(h4|p|ul)>(.*?)<\/\1>/gis;
	let m;
	while ((m = blockRe.exec(html))) {
		const [, tag, inner] = m;
		if (tag === 'h4') {
			children.push({ type: 'heading', level: 4, children: parseInline(inner.trim()) });
		} else if (tag === 'p') {
			children.push({ type: 'paragraph', children: parseInline(inner.trim()) });
		} else if (tag === 'ul') {
			const items = [];
			const liRe = /<li>(.*?)<\/li>/gis;
			let lm;
			while ((lm = liRe.exec(inner))) {
				items.push({ type: 'list-item', children: parseInline(lm[1].trim()) });
			}
			children.push({ type: 'list', listType: 'unordered', children: items });
		}
	}
	return { type: 'root', children };
}

export { htmlToRichText };
