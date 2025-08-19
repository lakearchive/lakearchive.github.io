const fs = require("fs"),
	CHUNKS_DIR = "./chunks_wpls/",
	files = fs.readdirSync(CHUNKS_DIR);

const out = [];

for (const file of files) {
	if (!file.endsWith("wpls")) continue;
	const stat = fs.statSync(CHUNKS_DIR + file);
	out.push([file, stat.size, stat.mtime.getTime()]);
};

fs.writeFileSync(CHUNKS_DIR + "index.json", JSON.stringify(out));
