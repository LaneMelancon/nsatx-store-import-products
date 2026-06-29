/** Minimal RFC4180 CSV parser (handles quoted fields, embedded commas/newlines, escaped quotes). */
function parseCSV(text) {
	const rows = [];
	let row = [];
	let field = '';
	let inQuotes = false;
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += c;
			i++;
			continue;
		}
		if (c === '"') {
			inQuotes = true;
			i++;
			continue;
		}
		if (c === ',') {
			row.push(field);
			field = '';
			i++;
			continue;
		}
		if (c === '\r') {
			i++;
			continue;
		}
		if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			i++;
			continue;
		}
		field += c;
		i++;
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** Parse CSV text into an array of objects keyed by the header row. */
function parseCSVObjects(text) {
	const rows = parseCSV(text).filter((r) => !(r.length === 1 && r[0] === ''));
	const header = rows[0];
	return rows.slice(1).map((r) => {
		const obj = {};
		header.forEach((h, idx) => {
			obj[h] = r[idx] ?? '';
		});
		return obj;
	});
}

export { parseCSV, parseCSVObjects };
