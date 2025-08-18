const PALETTE = [[0, 0, 0], [0, 0, 0], [60, 60, 60], [120, 120, 120], [210, 210, 210], [255, 255, 255], [96, 0, 24], [237, 28, 36], [255, 127, 39], [246, 170, 9], [249, 221, 59], [255, 250, 188], [14, 185, 104], [19, 230, 123], [135, 255, 94], [12, 129, 110], [16, 174, 166], [19, 225, 190], [40, 80, 158], [64, 147, 228], [96, 247, 242], [107, 80, 246], [153, 177, 251], [120, 12, 153], [170, 56, 185], [224, 159, 249], [203, 0, 122], [236, 31, 128], [243, 141, 169], [104, 70, 52], [149, 104, 42], [248, 178, 119], [170, 170, 170], [165, 14, 30], [250, 128, 114], [228, 92, 26], [214, 181, 148], [156, 132, 49], [197, 173, 49], [232, 212, 95], [74, 107, 58], [90, 148, 74], [132, 197, 115], [15, 121, 159], [187, 250, 242], [125, 199, 255], [77, 49, 184], [74, 66, 132], [122, 113, 196], [181, 174, 241], [219, 164, 99], [209, 128, 81], [255, 197, 165], [155, 82, 73], [209, 128, 120], [250, 182, 164], [123, 99, 82], [156, 132, 107], [51, 57, 65], [109, 117, 141], [179, 185, 209], [109, 100, 63], [148, 140, 107], [205, 197, 158]];

const paletteMap = new Map();
for (let id = 0; id < PALETTE.length; id++) {
	paletteMap.set(PALETTE[id].join(","), id);
}

function rleEncode(arr) {
	const out = [];
	let prev = arr[0], count = 1;
	for (let i = 1; i < arr.length; i++) {
		if (arr[i] === prev && count < 255) {
			count++;
		} else {
			out.push(count, prev);
			prev = arr[i];
			count = 1;
		}
	}
	out.push(count, prev);
	return new Uint8Array(out);
}

function rleDecode(arr) {
	const out = [];
	for (let i = 0; i < arr.length; i += 2) {
		const count = arr[i],
			id = arr[i + 1];
		for (let j = 0; j < count; j++) out.push(id);
	}
	return new Uint8Array(out);
}

function writeUInt16BE(buf, offset, value) {
	buf[offset] = (value >> 8) & 0xff;
	buf[offset + 1] = value & 0xff;
}

function writeUInt32BE(buf, offset, value) {
	buf[offset] = (value >> 24) & 0xff;
	buf[offset + 1] = (value >> 16) & 0xff;
	buf[offset + 2] = (value >> 8) & 0xff;
	buf[offset + 3] = value & 0xff;
}

function readUInt16BE(buf, offset) {
	return (buf[offset] << 8) | buf[offset + 1];
}

function readUInt32BE(buf, offset) {
	return (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
}

function pngToWpls(data, info, x, y, timestamp = Math.floor(Date.now() / 1e3)) {
	const { width, height } = info,
		indices = new Uint8Array(width * height);
	for (let i = 0; i < width * height; i++) {
		const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
		let id = 0;
		if (a !== 0) {
			id = paletteMap.get([r, g, b].join(","));
			if (id === undefined) throw new Error(`unknown color ${r},${g},${b}`);
		}
		indices[i] = id;
	}

	const compressed = pako.deflate(rleEncode(indices)),
		header = new Uint8Array(14);
	header.set([87, 80, 76, 83], 0); // WPLS
	writeUInt16BE(header, 4, 2); // version
	writeUInt16BE(header, 6, width);
	writeUInt16BE(header, 8, height);
	writeUInt16BE(header, 10, x);
	writeUInt16BE(header, 12, y);

	const blockHead = new Uint8Array(9);
	blockHead[0] = 0; // base block
	writeUInt32BE(blockHead, 1, timestamp);
	writeUInt32BE(blockHead, 5, compressed.length);

	return concatBuffers([header, blockHead, compressed]);
}

function wplsToPng(buf, cutoffTs = Infinity) {
	if (readUInt32BE(buf, 0) !== 0x57504c53) throw new Error("not a wpls file");
	const version = readUInt16BE(buf, 4);
	if (version !== 2) throw new Error("unsupported version");
	const width = readUInt16BE(buf, 6),
		height = readUInt16BE(buf, 8),
		x = readUInt16BE(buf, 10),
		y = readUInt16BE(buf, 12);

	let offset = 14,
		indices = new Uint8Array(width * height),
		latestTs = 0;

	while (offset < buf.length) {
		const blockType = buf[offset]; offset += 1;
		const timestamp = readUInt32BE(buf, offset); offset += 4;
		const blockSize = readUInt32BE(buf, offset); offset += 4;
		if (timestamp > cutoffTs) break;
		latestTs = timestamp;
		const compressed = buf.slice(offset, offset + blockSize); offset += blockSize;

		if (blockType === 0) {
			indices = rleDecode(pako.inflate(compressed));
		} else if (blockType === 1) {
			const delta = new Uint32Array(pako.inflate(compressed).buffer);
			for (let i = 0; i < delta.length; i++) {
				const packed = delta[i],
					id = packed & 0x3f,
					dy = (packed >> 6) & 0x3ff,
					dx = (packed >> 16) & 0x3ff;
				indices[dy * width + dx] = id;
			}
		} else throw new Error("unknown block type " + blockType);
	}

	const pixels = new Uint8Array(width * height * 4);
	for (let i = 0; i < indices.length; i++) {
		const id = indices[i], rgb = PALETTE[id];
		pixels[i * 4 + 0] = rgb[0];
		pixels[i * 4 + 1] = rgb[1];
		pixels[i * 4 + 2] = rgb[2];
		pixels[i * 4 + 3] = id ? 255 : 0;
	}

	return { width, height, x, y, timestamp: latestTs, indices, pixels };
}

function concatBuffers(arr) {
	let total = 0;
	for (const a of arr) total += a.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const a of arr) {
		out.set(a, offset);
		offset += a.length;
	}
	return out;
}

class WplsFile {
	metadata = {
		version: null,
		width: null,
		height: null,
		x: null,
		y: null,
		latestTimestamp: null,
		baseTimestamp: null
	}

	baseIndices = null;
	indices = null;
	deltas = [];

	constructor(buf) {
		if (readUInt32BE(buf, 0) !== 0x57504c53) throw new Error("not a wpls file");
		const version = readUInt16BE(buf, 4);
		if (version !== 2) throw new Error("unsupported version");
		Object.assign(this.metadata, {
			version,
			width: readUInt16BE(buf, 6),
			height: readUInt16BE(buf, 8),
			x: readUInt16BE(buf, 10),
			y: readUInt16BE(buf, 12)
		});
		this.#parse(buf);
	}

	#parse(buf) {
		const { width, height } = this.metadata;
		let offset = 14,
			indices = new Uint8Array(width * height),
			latestTs = 0;

		while (offset < buf.length) {
			const blockType = buf[offset]; offset += 1;
			const timestamp = readUInt32BE(buf, offset); offset += 4;
			const blockSize = readUInt32BE(buf, offset); offset += 4;

			// console.log({blockType, blockSize, timestamp})

			if (timestamp > latestTs) latestTs = timestamp;

			const compressed = buf.slice(offset, offset + blockSize); offset += blockSize;

			if (blockType === 0) {
				indices = rleDecode(pako.inflate(compressed));
				this.baseIndices = indices.slice();
				this.metadata.baseTimestamp = timestamp;
			} else if (blockType === 1) {
				const delta = new Uint32Array(pako.inflate(compressed).buffer);
				for (let i = 0; i < delta.length; i++) {
					const packed = delta[i],
						id = packed & 0x3f,
						dy = (packed >> 6) & 0x3ff,
						dx = (packed >> 16) & 0x3ff;
					indices[dy * width + dx] = id;
				}
				this.deltas.push([timestamp, delta]);
			} else throw new Error("unknown block type " + blockType);
		}

		this.indices = indices;
		this.metadata.latestTimestamp = latestTs;
	}

	toPng(cutoffTs = Infinity) {
		const { width, height } = this.metadata;
		const indices = this.baseIndices.slice();

		for (const [timestamp, delta] of this.deltas) {
			if (timestamp > cutoffTs) break;
			for (let i = 0; i < delta.length; i++) {
				const packed = delta[i],
					id = packed & 0x3f,
					dy = (packed >> 6) & 0x3ff,
					dx = (packed >> 16) & 0x3ff;
				indices[dy * width + dx] = id;
			}
		}

		const pixels = new Uint8Array(width * height * 4);
		for (let i = 0; i < indices.length; i++) {
			const id = indices[i],
				rgb = PALETTE[id];
			pixels[i * 4 + 0] = rgb[0];
			pixels[i * 4 + 1] = rgb[1];
			pixels[i * 4 + 2] = rgb[2];
			pixels[i * 4 + 3] = id ? 255 : 0;
		}
		return pixels;
	}

	appendPng(pngData, info, timestamp = Math.floor(Date.now() / 1e3)) {
		const { width, height } = info;
		if (this.metadata.width !== width || this.metadata.height !== height) throw new Error("dimension mismatch");

		const newIndices = new Uint8Array(width * height);
		for (let i = 0; i < width * height; i++) {
			const r = pngData[i * 4], g = pngData[i * 4 + 1], b = pngData[i * 4 + 2], a = pngData[i * 4 + 3];
			let id = 0;
			if (a !== 0) {
				id = paletteMap.get([r, g, b].join(","));
				if (id === undefined) throw new Error(`unknown color ${r},${g},${b}`);
			}
			newIndices[i] = id;
		}

		const diffs = [];
		for (let i = 0; i < newIndices.length; i++) {
			if (newIndices[i] !== this.indices[i]) {
				const dx = i % width,
					dy = Math.floor(i / width),
					id = newIndices[i];
				diffs.push((dx << 16) | (dy << 6) | id);
			}
		}

		if (diffs.length === 0) return false;

		this.deltas.push([timestamp, diffs]);
		this.indices = newIndices;
		return true;
	}

	toBuffer() {
		const { x, y, width, height, version } = this.metadata;
		const baseCompressed = pako.deflate(rleEncode(this.baseIndices));

		const header = new Uint8Array(14);
		header.set([87, 80, 76, 83], 0); // WPLS
		writeUInt16BE(header, 4, version);
		writeUInt16BE(header, 6, width);
		writeUInt16BE(header, 8, height);
		writeUInt16BE(header, 10, x);
		writeUInt16BE(header, 12, y);

		const blockHead = new Uint8Array(9);
		blockHead[0] = 0;
		writeUInt32BE(blockHead, 1, this.metadata.baseTimestamp);
		writeUInt32BE(blockHead, 5, baseCompressed.length);

		const out = [header, blockHead, baseCompressed];

		for (const [timestamp, diffs] of this.deltas) {
			const compressed = pako.deflate(new Uint8Array(new Uint32Array(diffs).buffer));
			const block = new Uint8Array(9);
			block[0] = 1;
			writeUInt32BE(block, 1, timestamp);
			writeUInt32BE(block, 5, compressed.length);
			out.push(block, compressed);
		}

		return concatBuffers(out);
	}
}
