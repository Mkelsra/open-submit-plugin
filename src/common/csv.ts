export function parseCSV(input: string, delimiter = ','): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let insideQuotes = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (char === '"') {
            // Toggle the insideQuotes flag
            insideQuotes = !insideQuotes;

            // Handle double quotes (escaped quotes)
            if (input[i + 1] === '"' && insideQuotes) {
                currentField += '"';
                i++; // Skip the next quote
            }
        } else if (char === delimiter && !insideQuotes) {
            // End of field
            currentRow.push(currentField);
            currentField = '';
        } else if (char === '\n' && !insideQuotes) {
            // End of row
            currentRow.push(currentField);
            rows.push(currentRow);
            currentRow = [];
            currentField = '';
        } else {
            // Append character to the current field
            currentField += char;
        }
    }

    // Add the last row and field
    if (currentField !== '' || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    return rows;
}