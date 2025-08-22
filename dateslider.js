class DateSlider {
	constructor(container, startTime, endTime, pxPerHour = 20) {
		this.container = document.createElement("div");
		this.container.className = "timeline-container";
		container.appendChild(this.container);

		this.timeline = document.createElement("div");
		this.timeline.className = "timeline-bar";
		this.container.appendChild(this.timeline);

		this.pointer = document.createElement("div");
		this.pointer.className = "pointer";
		this.container.appendChild(this.pointer);

		this.startTime = startTime;
		this.endTime = endTime;
		this.pxPerHour = pxPerHour;

		this.offset = 0;
		this.velocity = 0;
		this.raf = null;
		this.isDown = false;

		this.visibleMarks = [];
		this.bufferHours = 48;

		this.listeners = [];

		this.lastTs = null;

		this.calculateMetrics();
		this.buildInitialMarks();
		this.bindEvents();
		this.render();
	}

	calculateMetrics() {
		this.totalHours = (this.endTime - this.startTime) / 3600000;
		this.totalWidth = this.totalHours * this.pxPerHour;
	}

	updateRange(start, end) {
		this.startTime = start;
		this.endTime = end;
		this.calculateMetrics();
		this.render();
	}

	buildInitialMarks() {
		// ok nobody is gonna have a screen that can fit this much anyway
		for (let i = 0; i < 100; i++) {
			const mark = document.createElement("div");
			mark.className = "mark";
			const span = document.createElement("span");
			mark.appendChild(span);
			this.timeline.appendChild(mark);
			this.visibleMarks.push(mark);
		}
	}

	updateMarks() {
		const centerHour = (-this.offset + this.container.clientWidth / 2) / this.pxPerHour,
			startHour = Math.max(0, centerHour - this.bufferHours),
			endHour = Math.min(this.totalHours, centerHour + this.bufferHours),
			step = Math.ceil((endHour - startHour) / this.visibleMarks.length);

		for (let i = 0; i < this.visibleMarks.length; i++) {
			const mark = this.visibleMarks[i];

			const h = Math.floor(startHour + i * step);
			if (h > this.totalHours) {
				mark.style.display = "none";
				return;
			}

			mark.style.display = "block";
			mark.style.left = `${h * this.pxPerHour}px`;
			const span = mark.firstChild;
			if (h % 24 === 0) {
				span.textContent = h ? `Day ${h / 24}` : "Start";
				mark.style.borderColor = "var(--day-color)";
			} else {
				span.textContent = "";
				mark.style.borderColor = "var(--hour-color)";
			}
		}
	}

	clamp(v) {
		const centerShift = this.container.clientWidth / 2,
			minOffset = -this.totalWidth + centerShift,
			maxOffset = centerShift;

		return Math.min(maxOffset, Math.max(minOffset, v));
	}

	updatePosition() {
		if (this._updateTimer) clearTimeout(this._updateTimer);
		this._updateTimer = setTimeout(() => {
			const centerPos = this.container.clientWidth / 2 - this.offset;
			const hoursFromStart = centerPos / this.pxPerHour;
			const ts = this.startTime + hoursFromStart * 3600000;
			if (ts === this.lastTs) return;
			this.lastTs = ts;
			for (const callback of this.listeners) callback(ts);
		}, 5);
	}
	render() {
		this.timeline.style.transform = `translateX(${this.offset}px)`;
		this.updatePosition();
		this.updateMarks();
	}

	bindEvents() {
		const momentum = () => {
			if (Math.abs(this.velocity) > 0.1) {
				this.offset = this.clamp(this.offset + this.velocity);
				this.velocity *= 0; // not impled because laggy as hell
				this.render();
				this.raf = requestAnimationFrame(momentum);
			}
		};

		this.container.addEventListener("pointerdown", e => {
			this.isDown = true;
			this.lastX = e.clientX;
			this.velocity = 0;
			cancelAnimationFrame(this.raf);
		});

		window.addEventListener("pointermove", e => {
			if (!this.isDown) return;
			const dx = e.clientX - this.lastX;
			this.offset = this.clamp(this.offset + dx);
			this.velocity = dx;
			this.lastX = e.clientX;
			this.render();
		});

		window.addEventListener("pointerup", () => {
			if (!this.isDown) return;
			this.isDown = false;
			momentum();
		});

		this.container.addEventListener("wheel", e => {
			e.preventDefault();
			this.offset = this.clamp(this.offset - e.deltaY);
			this.render();
		});
	}

	setTimestamp(ts) {
		const hoursFromStart = (ts - this.startTime) / 3600000;
		const center = this.container.clientWidth / 2;
		this.offset = -(hoursFromStart * this.pxPerHour - center);
		this.render();
	}
}
