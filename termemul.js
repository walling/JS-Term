(function(termemul) {

	termemul.LowLevelTerminal = function() {

		var self = {
			grid: [],
			dirtyLines: {},
			cursor: { x: 0, y: 0, attr: 0x0088, visible: true },
			buffer: '',
			cursorId: 'cursor',
			onreset: null,
			columns: null,
			rows: null
		};

		var noop = function() {};

		self.attrToClass = function(attr) {
			return 'a' + ('0000' + (attr & 0x3FF).toString(16)).substr(-4).toUpperCase();
		};

		self.attrFromClass = function(className) {
			if (className) {
				return parseInt(className.substr(1), 16);
			} else {
				return 0x0088;
			}
		};

		self.renderLineAsHtml = function(lineNo) {
			if (lineNo >= self.grid.length) {
				return '';
			}

			var line = self.grid[lineNo];

			var lineLength = line.length;
			if (lineNo === self.cursor.y && self.cursor.x + 1 > lineLength) {
				lineLength = self.cursor.x + 1;
			}

			// TODO: Maybe optimize so we merge multiple spans into one if the attributes are equal. Not so easy though...
			var html = '';
			for (var i = 0; i < lineLength; i++) {
				var ach = line[i] || [self.cursor.attr, ' '];
				var a  = ach[0];
				var ch = ach[1];
				var isCursor = (lineNo === self.cursor.y && i === self.cursor.x && self.cursor.visible);
				if (isCursor) {
					a ^= 0x200;
				}
				var cursor = (isCursor ? ' id="' + self.cursorId + '"' : '');
				var style = (a & 0x400 ? ' style="text-decoration: underline;"' : '');

				html += '<span class="' + self.attrToClass(a) + '"' + cursor + style + '>' + ch + '</span>';
			}

			return html;
		};

		self.renderEachDirtyLine = function(iterator) {
			for (var lineNo in self.dirtyLines) {
				lineNo = lineNo | 0;
				iterator(lineNo, self.renderLineAsHtml(lineNo));
			}
			self.dirtyLines = {}; // Reset list of dirty lines after rendering
		};

		self.ensureLineExists = function(lineNo) {
			while (self.grid.length <= lineNo) {
				self.dirtyLines[self.grid.length] = true;
				self.grid.push([]);
			}
		};

		self.windowFirstLine = function() {
			return Math.max(0, self.grid.length - (self.rows || noop)() || 1);
		};

		self.emptyLineArray = function(maxSize) {
			maxSize = maxSize || 512;

			var array = [[self.cursor.attr, ' ']];
			for (var i = 0; i < 9; i++) {
				array = array.concat(array);
			}
			return array.slice(0, maxSize);
		};

/*
		self.replaceInString = function(string, index, replacement) {
			return string.substr(0, index) + replacement + string.substr(index + replacement.length);
		};
*/
		self.replaceInArray = function(array, index, replacement) {
			return array.slice(0, index).concat(replacement).concat(array.slice(index + replacement.length));
		};

		self.lowLevelReplaceChar = function(position, ach) {
			self.ensureLineExists(position.y);
			self.grid[position.y] = self.replaceInArray(self.grid[position.y], position.x, [ach]);
			self.dirtyLines[position.y] = true;
		};

		self.lowLevelSetCursor = function(newPosition) {
			self.dirtyLines[self.cursor.y] = true;
			if (newPosition.x !== undefined) {
				self.cursor.x = (newPosition.x < 0) ? 0 : newPosition.x;
				var cols = (self.columns || noop)() || 500;
				if (self.cursor.x > cols - 1) {
					self.cursor.x = cols - 1;
				}
				// TODO: Check that cursor is not going out of boundaries (x too large).
			}
			if (newPosition.y !== undefined) {
				self.cursor.y = (newPosition.y < 0) ? 0 : newPosition.y; // TODO: Maybe the smallest y-position if windowFirstLine ?
			}
			self.dirtyLines[self.cursor.y] = true;
			self.ensureLineExists(self.cursor.y);
		};

		self.lowLevelMoveCursor = function(direction) {
			self.lowLevelSetCursor({
				x: self.cursor.x + (direction.x || 0),
				y: self.cursor.y + (direction.y || 0)
			});
		};

		self.enterChar = function(ch) {
			self.lowLevelReplaceChar(self.cursor, [self.cursor.attr, ch]);
			self.lowLevelMoveCursor({ x: 1 });
		};

		self.backSpace = function() {
			self.lowLevelMoveCursor({ x: -1 });
		};

		self.carrigeReturn = function() {
			self.lowLevelSetCursor({ x: 0 });
		};

		self.lineFeed = function() {
			self.lowLevelMoveCursor({ y: 1 });
		};

		self.reset = function() {
			(self.onreset || noop)();
			self.grid = [];
			self.dirtyLines = {};
			self.cursor.x = 0;
			self.cursor.y = 0;
			self.cursor.attr = 0x0088;
			self.cursor.visible = true;
		};

		self.escapeCodeESC = function(command) {
			if (command === 'c') {
				self.reset();
			} else if (command === '(B') {
				// Do not handle and do not report about it. `top` on Linux outputs it.
			} else if (window.console && window.JSON) {
				console.log('Unhandled escape code ESC ' + JSON.stringify(command));
				// Used by `less`: ESC =, ESC >
				// Used by `reset`: ESC H, ESC >
			}
		};

		self.escapeCodeCSI = function(command, args) {
			if (command >= 'A' && command <= 'D') {
				var arg = parseInt(args[0] || '1', 10) || 1;
				if (arg <   0) { arg =   0; }
				if (arg > 500) { arg = 500; }
				var directions = {
					'A': { y: -arg },
					'B': { y:  arg },
					'C': { x:  arg },
					'D': { x: -arg }
				};
				self.lowLevelMoveCursor(directions[command]);
			} else if (command === 'G') {
				var arg = parseInt(args[0] || '0', 10) || 0;
				if (arg < 0) { arg = 0; }
				self.lowLevelSetCursor({ x: arg });
			} else if (command === 'H' || command === 'f') {
				var y = (parseInt(args[0] || '1', 10) || 1) - 1;
				var x = (parseInt(args[1] || '1', 10) || 1) - 1;
				self.lowLevelSetCursor({ x: x, y: y + self.windowFirstLine() });
			} else if (command === 'J') {
				var arg = parseInt(args[0] || '0', 10) || 0;
				var cols = (self.columns || noop)() || self.cursor.x + 1;
				var rows = (self.rows || noop)() || 1;
				var firstLine  = self.windowFirstLine();
				var lastLine   = firstLine + rows - 1;
				var cursorLine = self.cursor.y;
				if (arg === 1) {
					firstLine = cursorLine;
				} else if (arg !== 2) {
					lastLine = cursorLine;
				} else {
					firstLine = lastLine;
					lastLine  = firstLine + rows - 1;
					self.lowLevelSetCursor({ y: firstLine });
				}
				var emptyLine = self.emptyLineArray(cols);
				for (var y = firstLine; y <= lastLine; y++) {
					self.grid[y] = emptyLine.slice(0);
					self.dirtyLines[y] = true;
				}
			} else if (command === 'K') {
				var arg = parseInt(args[0] || '0', 10) || 0;
				var line = self.grid[self.cursor.y];
				if (arg === 1) {
					self.grid[self.cursor.y] = self.emptyLineArray(self.cursor.x + 1).concat(line.slice(self.cursor.x + 1));
				} else if (arg === 2) {
					self.grid[self.cursor.y] = [];
				} else {
					if (arg !== 0 && window.console && window.JSON) {
						console.log('Unknown argument for CSI "K": ' + arg);
					}
					self.grid[self.cursor.y] = line.slice(0, self.cursor.x);
				}
				self.dirtyLines[self.cursor.y] = true;
			} else if (command === 'P') {
				var arg = parseInt(args[0] || '1', 10) || 1;
				if (arg <   0) { arg =   0; }
				if (arg > 500) { arg = 500; }
				if (arg > 0) {
					var line = self.grid[self.cursor.y];
					self.grid[self.cursor.y] = line.slice(0, self.cursor.x).concat(line.slice(self.cursor.x + arg));
					self.dirtyLines[self.cursor.y] = true;
				}
			} else if (command === 'h') {
				var arg = args[0];
				if (arg === '?25') {
					self.cursor.visible = true;
				} else if (window.console && window.JSON) {
					console.log('Unknown argument for CSI "h": ' + JSON.stringify(arg));
				}
			} else if (command === 'l') {
				var arg = args[0];
				if (arg === '?25') {
					self.cursor.visible = false;
				} else if (window.console && window.JSON) {
					console.log('Unknown argument for CSI "l": ' + JSON.stringify(arg));
				}
			} else if (command === 'm') {
				for (var i = 0; i < args.length; i++) {
					var arg = parseInt(args[i], 10);
					if (arg === 0) {
						self.cursor.attr = 0x0088;
					} else if (arg === 1) {
						self.cursor.attr |= 0x0100;
					} else if (arg === 2) {
						self.cursor.attr &= ~0x0100;
					} else if (arg === 4) {
						self.cursor.attr |= 0x0400;
					} else if (arg === 7) {
						self.cursor.attr |= 0x0200;
					} else if (arg === 24) {
						self.cursor.attr &= ~0x0400;
					} else if (arg === 27) {
						self.cursor.attr &= ~0x0200;
					} else if (arg >= 30 && arg <= 37) {
						self.cursor.attr &= ~0x000F;
						self.cursor.attr |= arg - 30;
					} else if (arg === 39) {
						self.cursor.attr &= ~0x000F;
						self.cursor.attr |= 8;
					} else if (arg >= 40 && arg <= 47) {
						self.cursor.attr &= ~0x00F0;
						self.cursor.attr |= (arg - 40) << 4;
					} else if (arg === 49) {
						self.cursor.attr &= ~0x00F0;
						self.cursor.attr |= 8 << 4;
					} else if (window.console && window.JSON) {
						console.log('Unhandled escape code CSI argument for "m": ' + arg);
					}
				}
			} else if (window.console && window.JSON) {
				console.log('Unhandled escape code CSI ' + JSON.stringify(command) + ' ' + JSON.stringify(args));
			}
		};

		self.escapeCodeOSC = function(command) {
			if (command.substr(0, 2) === '0;') {
				document.title = command.substr(2);
			} else if (window.console && window.JSON) {
				console.log('Unhandled escape code OSC ' + JSON.stringify(command));
			}
		};

		self.parseBuffer = function() {
			var currentLength = 0;
			while (currentLength !== self.buffer.length && self.buffer.length > 0) {
				currentLength = self.buffer.length;
				if (self.buffer.substr(0, 1) === '\u001B') {
					var matches;
					if (matches = self.buffer.match(/^\u001B([()#][0-9A-Za-z]|[0-9A-Za-z<>=])/)) {
						self.buffer = self.buffer.substr(matches[0].length);
						self.escapeCodeESC(matches[1]);
					} else if (matches = self.buffer.match(/^(?:\u001B\[|\u009B)([ -?]*)([@-~])/)) {
						self.buffer = self.buffer.substr(matches[0].length);
						self.escapeCodeCSI(matches[2], matches[1] ? matches[1].split(';') : []);
					} else if (matches = self.buffer.match(/^\u001B\](.*)(?:\u0007|\u001B\\)/)) {
						self.buffer = self.buffer.substr(matches[0].length);
						self.escapeCodeOSC(matches[1]);
					} else if (self.buffer.match(/[^\u0001-~\u009B]/)) {
						// fail-safe thingy... if no escape codes can be parsed and buffer
						// contains characters outside ASCII, then something is wrong.
						// Escape codes use characters within ASCII.
						if (window.console && window.JSON) {
							console.log('Removing ESC character, because of bad parse: ' + JSON.stringify(self.buffer));
						}
						self.buffer = self.buffer.substr(1); // <-- KIND OF HACK :)
					} else if (window.console && window.JSON) {
						console.log('Unhandled escape codes ' + JSON.stringify(self.buffer));
					}
				} else {
					var ch = self.buffer.substr(0, 1);
					self.buffer = self.buffer.substr(1);
					if (ch === '\b') {
						self.backSpace();
					} else if (ch === '\r') {
						self.carrigeReturn();
					} else if (ch === '\n') {
						self.lineFeed();
					} else if (ch >= ' ') {
						self.enterChar(ch);
					} else if (window.console && window.JSON) {
						console.log('Unhandled character ' + JSON.stringify(ch));
					}
				}
			}
			if (self.buffer.length > 0 && window.console && window.JSON) {
				console.log('Unparsed buffer ' + JSON.stringify(self.buffer));
			}
		};

		self.write = function(data) {
			self.buffer += data;
			self.parseBuffer();
		};

		self.attributeToCss = function(colors, attr, selected) {
			if (selected) {
				attr = (attr ^ 0x200) & ~0x100;
			}
			var bright  = attr & 0x100;
			var inverse = attr & 0x200;
			var bgIndex = (attr >> 4) & 0xF;
			var fgIndex =  attr       & 0xF;
			if (bgIndex >= 8) { bgIndex = 16; }
			if (fgIndex >= 8) { fgIndex = 17; }
			if (inverse) {
				var swap = bgIndex;
				bgIndex  = fgIndex;
				fgIndex  = swap;
			}
			if (fgIndex < 8 && bright) { fgIndex |= 8; }
			return 'color: ' + colors[fgIndex] + ';' +
				(bgIndex !== 16 || inverse || selected ? ' background: ' + colors[bgIndex] + ';' : '') +
				(bright ? ' font-weight: bold;' : '');
		};

		self.compileAttributesAsCss = function(colors) {
			var css = '\r\n';
			for (var misc = 0; misc <= 3; misc++) {
				for (var bg = 0; bg <= 8; bg++) {
					for (var fg = 0; fg <= 8; fg++) {
						var attr = misc << 8 | bg << 4 | fg;
						var classSel = '.' + self.attrToClass(attr);
						css += classSel + ' { ' + self.attributeToCss(colors, attr) + ' }\r\n';
						css += classSel + '::selection { ' + self.attributeToCss(colors, attr, true) + ' }\r\n';
					}
				}
			}
			return css;
		};

		return self;
	};


	termemul.JQueryTerminal = function(element, inputElement) {
		inputElement = inputElement || window;

		var noop = function() {};
		var $window = $(window);

		var self = {
			term: termemul.LowLevelTerminal(),
			terminalElement: $(element),
			terminalInputElement: $(inputElement),
			oninput: null,
			cursorBlinkId: undefined,
			cursorBlinkSpeed: 500,
			_colors: null,
			stylesheetId: 'terminal-css'
		};

		self.softReset = function() {
			self.terminalElement.html('<div class="a0088"></div>');
			(self.invalidateCachedNumberOfLines || noop)();
		};
		self.term.onreset = self.softReset;
		self.softReset();

		self.terminalInputElement.keydown(function(e) {
			var shift = e.shiftKey;
			var ctrl  = e.ctrlKey;
			var meta  = e.altKey;
			var mods   = shift || ctrl || meta;
			var onlyShift = shift && !( ctrl || meta);
			var onlyCtrl  = ctrl  && !(shift || meta);
			var onlyMeta  = meta  && !(shift || ctrl);
			//console.log('keydown... ' + e.keyCode, shift, ctrl, meta);
			if (!mods && (e.keyCode === 8 || e.keyCode === 9 || e.keyCode === 27)) {
				var ch = String.fromCharCode(e.keyCode);
				(self.oninput || noop)(ch);
				e.preventDefault();
				return false;
			} else if (!mods && e.keyCode === 37) { // Left arrow
				(self.oninput || noop)('\u001B[D');
				e.preventDefault();
				return false;
			} else if (!mods && e.keyCode === 38) { // Up arrow
				(self.oninput || noop)('\u001B[A');
				e.preventDefault();
				return false;
			} else if (!mods && e.keyCode === 39) { // Right arrow
				(self.oninput || noop)('\u001B[C');
				e.preventDefault();
				return false;
			} else if (!mods && e.keyCode === 40) { // Down arrow
				(self.oninput || noop)('\u001B[B');
				e.preventDefault();
				return false;
			} else if (onlyCtrl && e.keyCode >= 65 && e.keyCode <= 90) { // Ctrl + A-Z
				var ch = String.fromCharCode(e.keyCode - 64);
				(self.oninput || noop)(ch);
				e.preventDefault();
				return false;
			} else if (mods && e.keyCode === 90) { // Panic debug button: Try to force stop a program
				(self.oninput || noop)('\u001A');
				(self.oninput || noop)('\u001A');
				(self.oninput || noop)('\u001A');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('\r');
				(self.oninput || noop)('reset\r');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('æ');
				(self.oninput || noop)('\u0008\u0008');
				(self.oninput || noop)('jobs\r');
				e.preventDefault();
				return false;
			} else if (window.console) {
				//console.log('Unhandled keydown ' + e.keyCode);
			}
		});
		self.terminalInputElement.keypress(function(e) {
			//console.log('keypress... ' + e.keyCode);
			var ch = String.fromCharCode(e.keyCode);
			if (ch === '\r' || ch >= ' ') {
				(self.oninput || noop)(ch);
			} else if (window.console && window.JSON) {
				console.log('Unhandled keypress ' + JSON.stringify(ch));
			}
			e.preventDefault();
			return false;
		});
		self.terminalInputElement.keyup(function(e) {
			//console.log('keyup... ' + e.keyCode);
		});

		self.applyTerminalCss = function(css) {
			if (!document.getElementById(self.stylesheetId)) {
				$('<style type="text/css" id="' + self.stylesheetId + '">' + css + '</style>').appendTo($('head'));
			} else {
				$('#' + self.stylesheetId).html(css);
			}
		};

		self.theme = function(newColors) {
			if (newColors === undefined) {
				return self._colors.slice(0);
			} else {
				self._colors = newColors.slice(0);
				self.applyTerminalCss(self.term.compileAttributesAsCss(self._colors));
			}
		};

		self.themes = {
			'Tango': [
				'#000000', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
				'#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
				'#ffffff', '#1a1a1a' ],
			'Linux Terminal': [
				'#000', '#a00', '#0a0', '#a50', '#00a', '#a0a', '#0aa', '#aaa',
				'#555', '#f55', '#5f5', '#ff5', '#55f', '#f5f', '#5ff', '#fff',
				'#000', '#fff' ]
		};
		self.theme(self.themes['Linux Terminal']);

		var cachedScrollTop = null;
		self.scrollSnap = function() {
			var characterHeight = self.characterHeight();
			var position = $window.scrollTop();
			var snapPosition = Math.floor(Math.floor(position / characterHeight) * characterHeight);
			if (position !== snapPosition) {
				$window.scrollTop(snapPosition);
				cachedScrollTop = snapPosition;
			}
			return false;
		};

		self.enableScrollSnapping = function() {
			$window.scroll(self.scrollSnap);
			$window.resize(self.scrollSnap);
			setTimeout(self.scrollSnap, 0);
		};
		self.enableScrollSnapping();

		self.scrollToBottom = function() {
			var firstLine = self.numberOfLines() - 1 - self.rows();
			if (firstLine < 0) {
				firstLine = 0;
			}
			var position = firstLine * self.characterHeight();
			if (position !== cachedScrollTop) {
				$window.scrollTop(position);
				cachedScrollTop = position;
			}
			return false;
		};
		$window.resize(function() {
			self.invalidateCachedSize();
			self.scrollToBottom();
			return false;
		});

		self.startCursorBlinking = function() {
			self.stopCursorBlinking();
			self.cursorBlinkId = window.setInterval(function() {
				var cursor = $('#' + self.term.cursorId);
				var attr = self.term.attrFromClass(cursor.attr('class'));
				attr ^= 0x200;
				cursor.attr('class', self.term.attrToClass(attr));
			}, self.cursorBlinkSpeed);
		};

		self.stopCursorBlinking = function() {
			if (self.cursorBlinkId !== undefined) {
				window.clearInterval(self.cursorBlinkId);
			}
			self.cursorBlinkId = undefined;
		};

		var cachedNumberOfLines = null;
		self.numberOfLines = function() {
			if (!cachedNumberOfLines) {
				cachedNumberOfLines = self.terminalElement.find('> *').size() || 1;
			}
			return cachedNumberOfLines;
		};

		self.invalidateCachedNumberOfLines = function() {
			cachedNumberOfLines = null;
			return false;
		};

		var cachedCharacterWidth = null;
		self.characterWidth = function() {
			if (!cachedCharacterWidth) {
				var ch = self.terminalElement.find('> * > *');
				cachedCharacterWidth = ch.innerWidth() || 1; // TODO: Is this really stable crossbrowser?
			}
			return cachedCharacterWidth;
		};

		var cachedCharacterHeight = null;
		self.characterHeight = function() {
			if (!cachedCharacterHeight) {
				var line = self.terminalElement.find('> *');
				cachedCharacterHeight = line.innerHeight() || 1; // TODO: Is this really stable crossbrowser?
			}
			return cachedCharacterHeight;

			/* OLD WAY TO DO IT (is it slower?)
			var lines  = self.numberOfLines();
			var height = self.height();
			return (height / lines) || 1;
			*/
		};

		self.invalidateCachedCharacterSize = function() {
			cachedCharacterWidth  = null;
			cachedCharacterHeight = null;
			self.invalidateCachedSize();
			return false;
		};

		self.width = function() {
			return self.terminalElement.innerWidth();
		};

		self.height = function() {
			return self.terminalElement.innerHeight();
		};

		var cachedColumns = null;
		self.columns = function() {
			if (!cachedColumns) {
				cachedColumns = Math.floor($window.width()  / self.characterWidth());
			}
			return cachedColumns;
		};
		self.term.columns = self.columns;

		var cachedRows = null;
		self.rows = function() {
			if (!cachedRows) {
				cachedRows = Math.floor($window.height() / self.characterHeight());
			}
			return cachedRows;
		};
		self.term.rows = self.rows;

		self.size = function() {
			return {
				x: self.columns(),
				y: self.rows()
			};
		};

		self.invalidateCachedSize = function() {
			cachedColumns = null;
			cachedRows = null;
			return false;
		};

		self.ensureLineExists = function(lineNo) {
			var missingLines = lineNo - self.numberOfLines() + 2;
			if (missingLines > 0) {
				var html = '';
				for (var i = 0; i < missingLines; i++) {
					html += '<div class="a0088"></div>';
				}
				self.terminalElement.append(html);
				self.invalidateCachedNumberOfLines();
			}
		};

		self.write = function(data) {
			self.term.write(data);
			self.term.renderEachDirtyLine(function(lineNo, html) {
				self.ensureLineExists(lineNo);
				self.terminalElement.find('> :eq(' + lineNo + ')').html(html);
			});
			self.scrollToBottom(); // Auto-scroll always on right now.
			self.startCursorBlinking();
		};

		return self;
	};

})(window.termemul = {});
