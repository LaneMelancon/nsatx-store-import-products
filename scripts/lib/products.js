/** Group CSV rows by Handle: parent row (Product Title set) + its continuation rows. */
function groupProducts(rows) {
	const groups = [];
	let current = null;
	for (const row of rows) {
		if (row['Product Title']) {
			current = { handle: row['Handle'], parent: row, rows: [row] };
			groups.push(current);
		} else {
			current.rows.push(row);
		}
	}
	return groups;
}

export { groupProducts };
