// 2048 Game Logic with Chrome Storage Integration and Animations
const APP_VERSION = 'v30'; // Should match sw.js CACHE_NAME version

class Game2048 {
	constructor() {
		this.gridSize = 4;
		this.grid = [];
		this.tiles = new Map(); // Track tiles by unique ID
		this.nextTileId = 1;
		this.score = 0;
		this.bestScore = 0;
		this.gameOver = false;
		this.won = false;
		this.animating = false;
		this.history = []; // Store game states for undo (max 32 steps)
		this.maxHistorySteps = 32;
		this.nextFixedValue = null; // Fixed value for next random tile (4 or 8)
		this.fixed8DisplayValue = 8; // Current display value for button 8 (easter egg)
		this.lastAutoSaveTime = 0; // Timestamp of last periodic auto-save
		this.autoSaveInterval = 30000; // Normal play: save at most once every 30s
		this.selectedCell = null; // Selected cell position {row, col} for next tile placement
		this.lastClickedCell = null; // Track last clicked cell for second click detection
		this.isCheating = false; // Cheating flag: true if used fixed value >= 8 or selected cell position

		// Logic optimization properties
		this.inputQueue = [];
		this.isMoving = false;

		this.gridContainer = document.getElementById('grid-container');
		this.tileContainer = document.getElementById('tile-container');
		this.scoreElement = document.getElementById('score');
		this.bestScoreElement = document.getElementById('best-score');
		this.gameMessage = document.getElementById('game-message');
		this.undoBtn = document.getElementById('undo-btn');
		this.undoFromGameOverBtn = document.getElementById('undo-from-gameover');
		this.fixed4Btn = document.getElementById('fixed-4-btn');
		this.fixed8Btn = document.getElementById('fixed-8-btn');
		this.gameTitle = document.getElementById('game-title');
		this.appVersionElement = document.getElementById('app-version');

		this.init();
	}

	async init() {
		this.createGrid();
		this.setupEventListeners();
		await this.loadBestScore();
		await this.loadGameState();
		// Ensure undo button state is correct after loading
		this.updateUndoButton();
		// Ensure fixed value buttons state is correct
		this.updateFixedValueButtons();
		// Initial check for post-update notification
		this.checkPostUpdateStatus();
		// Setup page unload handler to save state immediately
		this.setupUnloadHandler();
	}

	createGrid() {
		// Create grid cells
		for (let i = 0; i < this.gridSize * this.gridSize; i++) {
			const cell = document.createElement('div');
			cell.className = 'grid-cell';
			const row = Math.floor(i / this.gridSize);
			const col = i % this.gridSize;
			cell.dataset.row = row;
			cell.dataset.col = col;

			// Add click event listener for cell selection
			cell.addEventListener('click', (e) => {
				this.handleCellClick(row, col);
			});

			this.gridContainer.appendChild(cell);
		}

		// Initialize grid array
		this.grid = Array(this.gridSize).fill(null).map(() => Array(this.gridSize).fill(null));
	}

	setupEventListeners() {
		// Keyboard controls
		document.addEventListener('keydown', async (e) => {
			if (this.gameOver || this.animating) return;

			const key = e.key;
			let direction = null;

			switch (key) {
				case 'ArrowUp':
					e.preventDefault();
					direction = 'up';
					break;
				case 'ArrowDown':
					e.preventDefault();
					direction = 'down';
					break;
				case 'ArrowLeft':
					e.preventDefault();
					direction = 'left';
					break;
				case 'ArrowRight':
					e.preventDefault();
					direction = 'right';
					break;
			}

			if (direction) {
				await this.move(direction);
			}
		});

		// Touch controls for mobile devices
		this.setupTouchControls();

		// New game button
		document.getElementById('new-game').addEventListener('click', () => {
			this.newGame();
		});

		// Retry button
		document.getElementById('retry').addEventListener('click', () => {
			this.hideMessage();
			this.newGame();
		});

		// Fixed value buttons (4 and 8)
		this.fixed4Btn.addEventListener('click', () => {
			// Toggle: if already active, deactivate; otherwise activate with value 4
			if (this.nextFixedValue === 4) {
				// Cancel selection
				this.setNextFixedValue(null);
			} else {
				// Activate with value 4
				this.setNextFixedValue(4);
			}
		});

		this.fixed8Btn.addEventListener('click', () => {
			// Easter egg: if button 8 is already active, double the value
			const isActive = this.fixed8Btn.classList.contains('active');
			if (isActive && this.nextFixedValue !== null && this.nextFixedValue >= 8) {
				// If value is 2048, cancel selection; otherwise double the value
				if (this.fixed8DisplayValue === 2048) {
					// Cancel selection
					this.setNextFixedValue(null);
					this.fixed8DisplayValue = 8;
					this.fixed8Btn.textContent = 8;
				} else {
					// Double the display value: 8 -> 16 -> 32 -> ... -> 2048
					this.fixed8DisplayValue *= 2;
					// Update the fixed value to the new display value
					this.setNextFixedValue(this.fixed8DisplayValue);
					// Update button text
					this.fixed8Btn.textContent = this.fixed8DisplayValue;
				}
			} else {
				// First click: activate button 8 with value 8
				this.fixed8DisplayValue = 8;
				this.setNextFixedValue(8);
				this.fixed8Btn.textContent = 8;
			}
		});

		// Undo button
		this.undoBtn.addEventListener('click', () => {
			this.undo();
		});

		// Undo button from game over message
		if (this.undoFromGameOverBtn) {
			this.undoFromGameOverBtn.addEventListener('click', () => {
				this.undo();
			});
		}

		// Check for updates (click title)
		if (this.gameTitle) {
			this.gameTitle.parentElement.addEventListener('click', () => this.checkForUpdates());
		}
	}

	// Helper function to parse gap value from computed style (iOS Safari compatible)
	parseGap() {
		const computedStyle = window.getComputedStyle(this.gridContainer);
		const gapStyle = computedStyle.gap;

		// Debug on iOS
		if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
			console.log('iOS Debug - gapStyle:', gapStyle, 'type:', typeof gapStyle);
		}

		if (!gapStyle) return 15; // default

		// Handle "15px" format
		const gapMatch = gapStyle.match(/(\d+(?:\.\d+)?)px/);
		if (gapMatch) {
			const gapValue = parseFloat(gapMatch[1]);
			if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
				console.log('iOS Debug - Parsed gap from match:', gapValue);
			}
			return gapValue;
		}

		// Handle numeric value
		const numGap = parseFloat(gapStyle);
		if (!isNaN(numGap)) {
			if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
				console.log('iOS Debug - Parsed gap from parseFloat:', numGap);
			}
			return numGap;
		}

		if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
			console.log('iOS Debug - Using fallback gap: 15');
		}
		return 15; // fallback
	}

	setupTouchControls() {
		let touchStartX = null;
		let touchStartY = null;
		const minSwipeDistance = 30; // Minimum distance for a swipe

		const gameContainer = document.querySelector('.game-container');
		const swipeArea = document.querySelector('.swipe-area');
		const touchTargets = [gameContainer, swipeArea].filter(el => el !== null);

		// Prevent pull-to-refresh and page scrolling on mobile when touching game container
		let isTouchingGameContainer = false;
		let touchStartYGlobal = null;
		let touchStartXGlobal = null;

		// Helper function to check if touch is within game area
		const isTouchInGameArea = (e) => {
			const touch = e.touches[0] || e.changedTouches[0];
			if (!touch) return false;

			// Check if touch is within game container or swipe area
			const gameContainerRect = gameContainer?.getBoundingClientRect();
			const swipeAreaRect = swipeArea?.getBoundingClientRect();

			if (gameContainerRect) {
				const inGameContainer = touch.clientX >= gameContainerRect.left &&
					touch.clientX <= gameContainerRect.right &&
					touch.clientY >= gameContainerRect.top &&
					touch.clientY <= gameContainerRect.bottom;
				if (inGameContainer) return true;
			}

			if (swipeAreaRect) {
				const inSwipeArea = touch.clientX >= swipeAreaRect.left &&
					touch.clientX <= swipeAreaRect.right &&
					touch.clientY >= swipeAreaRect.top &&
					touch.clientY <= swipeAreaRect.bottom;
				if (inSwipeArea) return true;
			}

			return false;
		};

		// Helper function to handle touch start
		const handleTouchStart = (e) => {
			if (isTouchInGameArea(e)) {
				isTouchingGameContainer = true;
				const firstTouch = e.touches[0];
				touchStartYGlobal = firstTouch.clientY;
				touchStartXGlobal = firstTouch.clientX;

				if (this.gameOver || this.animating) return;
				touchStartX = firstTouch.clientX;
				touchStartY = firstTouch.clientY;
			}
		};

		// Helper function to handle touch end
		const handleTouchEnd = async (e) => {
			if (!isTouchingGameContainer) return;

			if (this.gameOver || this.animating || touchStartX === null || touchStartY === null) {
				isTouchingGameContainer = false;
				touchStartXGlobal = null;
				touchStartYGlobal = null;
				return;
			}

			const touchEndX = e.changedTouches[0].clientX;
			const touchEndY = e.changedTouches[0].clientY;

			const deltaX = touchEndX - touchStartX;
			const deltaY = touchEndY - touchStartY;

			const absDeltaX = Math.abs(deltaX);
			const absDeltaY = Math.abs(deltaY);

			// Determine if it's a valid swipe
			if (absDeltaX < minSwipeDistance && absDeltaY < minSwipeDistance) {
				touchStartX = null;
				touchStartY = null;
				isTouchingGameContainer = false;
				touchStartXGlobal = null;
				touchStartYGlobal = null;
				return;
			}

			let direction = null;

			// Determine swipe direction
			if (absDeltaX > absDeltaY) {
				// Horizontal swipe
				direction = deltaX > 0 ? 'right' : 'left';
			} else {
				// Vertical swipe
				direction = deltaY > 0 ? 'down' : 'up';
			}

			if (direction) {
				e.preventDefault();
				await this.move(direction);
			}

			touchStartX = null;
			touchStartY = null;
			isTouchingGameContainer = false;
			touchStartXGlobal = null;
			touchStartYGlobal = null;
		};

		// Helper function to handle touch end (for cleanup)
		const handleTouchEndCleanup = () => {
			isTouchingGameContainer = false;
			touchStartYGlobal = null;
			touchStartXGlobal = null;
		};

		// Add event listeners to all touch targets
		touchTargets.forEach(target => {
			target.addEventListener('touchstart', handleTouchStart, { passive: true });
			target.addEventListener('touchend', handleTouchEnd, { passive: false });
			target.addEventListener('touchend', handleTouchEndCleanup, { passive: true });
			target.addEventListener('touchcancel', handleTouchEndCleanup, { passive: true });
		});

		// Global touchmove handler to prevent page scrolling when touching game area
		document.addEventListener('touchmove', (e) => {
			if (isTouchingGameContainer && touchStartYGlobal !== null && touchStartXGlobal !== null) {
				// Always prevent default scrolling when touching game area
				// This prevents the page from moving during swipe gestures
				e.preventDefault();
			} else if (isTouchingGameContainer && touchStartYGlobal !== null) {
				// Fallback: prevent pull-to-refresh when touching game container and scrolling down from top
				const currentY = e.touches[0]?.clientY;
				if (currentY !== undefined) {
					const deltaY = currentY - touchStartYGlobal;
					// If at top of page and scrolling down, prevent pull-to-refresh
					if (window.scrollY === 0 && deltaY > 0) {
						e.preventDefault();
					}
				}
			}
		}, { passive: false });
	}

	newGame() {
		// Save current state to history before starting new game
		// Only save if there's an actual game state (not initial empty state)
		if (this.tiles.size > 0 || this.score > 0) {
			this.saveStateToHistory();
		}

		// Clear all tile DOM elements first
		this.tileContainer.innerHTML = '';

		// Reset game state
		this.grid = Array(this.gridSize).fill(null).map(() => Array(this.gridSize).fill(null));
		this.tiles.clear();
		this.nextTileId = 1;
		this.score = 0;
		this.gameOver = false;
		this.won = false;
		// Don't clear history - keep it so user can undo to previous game
		this.nextFixedValue = null; // Reset fixed value
		this.fixed8DisplayValue = 8; // Reset button 8 display value
		this.selectedCell = null; // Clear selected cell
		this.lastClickedCell = null; // Clear last clicked cell
		this.isCheating = false; // Reset cheating flag for new game
		this.updateFixedValueButtons(); // Update button states
		this.updateSelectedCellDisplay(); // Clear selection display

		// Start new game
		this.addRandomTile();
		this.addRandomTile();
		this.renderTiles();
		this.updateScore();
		this.updateUndoButton();
		// New game is important, save immediately
		this.saveGameStateImmediate();
	}

	saveStateToHistory() {
		// Create a deep copy of current game state
		const tilesArray = Array.from(this.tiles.entries()).map(([id, tile]) => ({
			id,
			value: tile.value,
			row: tile.row,
			col: tile.col
		}));

		const state = {
			grid: this.grid.map(row => [...row]), // Deep copy grid
			tiles: tilesArray,
			nextTileId: this.nextTileId,
			score: this.score,
			gameOver: this.gameOver,
			won: this.won,
			isCheating: this.isCheating
		};

		// Add to history
		this.history.push(state);

		// Keep only last maxHistorySteps states
		if (this.history.length > this.maxHistorySteps) {
			this.history.shift(); // Remove oldest state
		}
	}

	undo() {
		// Double check: if button is disabled, don't proceed
		if (this.undoBtn && this.undoBtn.disabled &&
			(!this.undoFromGameOverBtn || this.undoFromGameOverBtn.disabled)) {
			return;
		}

		if (this.history.length === 0 || this.animating) {
			return;
		}

		// Allow undo even when game is over

		// Get the last saved state
		const previousState = this.history.pop();

		// Restore game state
		this.grid = previousState.grid.map(row => [...row]);
		this.nextTileId = previousState.nextTileId;
		this.score = previousState.score;
		this.gameOver = previousState.gameOver;
		this.won = previousState.won;
		this.isCheating = previousState.isCheating || false; // Restore cheating flag

		// Reconstruct tiles Map
		this.tileContainer.innerHTML = '';
		this.tiles.clear();
		previousState.tiles.forEach(tileData => {
			this.tiles.set(tileData.id, {
				id: tileData.id,
				value: tileData.value,
				row: tileData.row,
				col: tileData.col,
				isNew: false,
				mergedFrom: null
			});
		});

		// Clear selected cell state (not part of game state)
		this.selectedCell = null;
		this.lastClickedCell = null;

		// Fix: heal any inconsistencies in the restored history snapshot before rendering
		this.validateAndHealState();
		// Render tiles and update UI
		this.renderTiles();
		this.updateScore();
		this.updateUndoButton();
		this.updateSelectedCellDisplay();
		// Hide game over message if it's showing
		this.hideMessage();
		this.saveGameState();
	}

	updateUndoButton() {
		if (this.undoBtn) {
			// Enable button if there's history
			// Allow undo even when game is over
			// Don't disable during animation to reduce UI flickering
			this.undoBtn.disabled = this.history.length === 0;
		}
		if (this.undoFromGameOverBtn) {
			// Enable game over undo button if there's history
			// Don't disable during animation to reduce UI flickering
			this.undoFromGameOverBtn.disabled = this.history.length === 0;
		}
	}

	setNextFixedValue(value) {
		// Set the fixed value for the next random tile (null to cancel selection)
		this.nextFixedValue = value;
		// Update button states immediately when user clicks (not during animation)
		// Use requestAnimationFrame to ensure smooth update
		requestAnimationFrame(() => {
			this.updateFixedValueButtons();
		});
	}

	updateFixedValueButtons() {
		// Only update if state actually changed to avoid unnecessary re-renders
		if (this.fixed4Btn) {
			const shouldBeActive = this.nextFixedValue === 4;
			const isActive = this.fixed4Btn.classList.contains('active');

			// Only update if state changed
			if (shouldBeActive && !isActive) {
				this.fixed4Btn.classList.add('active');
			} else if (!shouldBeActive && isActive) {
				this.fixed4Btn.classList.remove('active');
			}
		}

		if (this.fixed8Btn) {
			// Button 8 is active if nextFixedValue matches any power of 2 from 8 to 2048
			const shouldBeActive = this.nextFixedValue !== null &&
				this.nextFixedValue >= 8 &&
				this.nextFixedValue <= 2048 &&
				(this.nextFixedValue & (this.nextFixedValue - 1)) === 0; // Check if power of 2
			const isActive = this.fixed8Btn.classList.contains('active');

			// Only update if state changed
			if (shouldBeActive && !isActive) {
				this.fixed8Btn.classList.add('active');
				// Update button text to show current value
				if (this.nextFixedValue !== null) {
					this.fixed8DisplayValue = this.nextFixedValue;
					this.fixed8Btn.textContent = this.nextFixedValue;
				}
			} else if (!shouldBeActive && isActive) {
				this.fixed8Btn.classList.remove('active');
				// Reset button text to 8 when deactivated
				this.fixed8DisplayValue = 8;
				this.fixed8Btn.textContent = 8;
			} else if (shouldBeActive && isActive) {
				// Update button text if value changed while active
				if (this.nextFixedValue !== null && this.nextFixedValue !== this.fixed8DisplayValue) {
					this.fixed8DisplayValue = this.nextFixedValue;
					this.fixed8Btn.textContent = this.nextFixedValue;
				}
			}
		}
	}

	handleCellClick(row, col) {
		// Don't handle clicks during animation or game over
		if (this.animating || this.gameOver) return;

		// Check if cell is empty
		if (this.grid[row][col] !== null) return;

		const isSameCell = this.lastClickedCell &&
			this.lastClickedCell.row === row &&
			this.lastClickedCell.col === col;

		// If clicking on already selected cell, deselect it
		if (this.selectedCell && this.selectedCell.row === row && this.selectedCell.col === col) {
			this.clearSelectedCell();
			// Also clear last clicked cell when deselecting
			this.lastClickedCell = null;
			return;
		}

		// Check if clicking the same cell for the second time (no time limit)
		if (isSameCell) {
			// Second click on the same cell - select it
			this.setSelectedCell(row, col);
			// Clear last clicked cell after selection
			this.lastClickedCell = null;
		} else {
			// First click on this cell - record it for potential second click
			this.lastClickedCell = { row, col };
		}
	}

	setSelectedCell(row, col) {
		// Clear previous selection
		this.clearSelectedCell();

		// Set new selection
		this.selectedCell = { row, col };
		this.updateSelectedCellDisplay();
	}

	clearSelectedCell() {
		if (this.selectedCell) {
			const cell = this.getCellElement(this.selectedCell.row, this.selectedCell.col);
			if (cell) {
				cell.classList.remove('selected');
			}
			this.selectedCell = null;
		}
	}

	updateSelectedCellDisplay() {
		// Clear all selections first
		const allCells = this.gridContainer.querySelectorAll('.grid-cell');
		allCells.forEach(cell => cell.classList.remove('selected'));

		// Add selection to current cell if exists
		if (this.selectedCell) {
			const cell = this.getCellElement(this.selectedCell.row, this.selectedCell.col);
			if (cell) {
				cell.classList.add('selected');
			}
		}
	}

	getCellElement(row, col) {
		const cells = this.gridContainer.querySelectorAll('.grid-cell');
		const index = row * this.gridSize + col;
		return cells[index] || null;
	}

	addRandomTile(isNew = true) {
		const emptyCells = [];
		for (let r = 0; r < this.gridSize; r++) {
			for (let c = 0; c < this.gridSize; c++) {
				if (this.grid[r][c] === null) {
					emptyCells.push({ r, c });
				}
			}
		}

		if (emptyCells.length > 0) {
			let r, c;
			let usedSelectedCell = false;

			// Check if there's a selected cell and it's empty
			if (this.selectedCell && this.grid[this.selectedCell.row][this.selectedCell.col] === null) {
				// Use selected cell
				r = this.selectedCell.row;
				c = this.selectedCell.col;
				usedSelectedCell = true;
				// Clear selection after use (only valid for this move)
				this.clearSelectedCell();
			} else {
				// Random selection
				const selected = emptyCells[Math.floor(Math.random() * emptyCells.length)];
				r = selected.r;
				c = selected.c;
			}

			// Use fixed value if set, otherwise use normal random logic
			let value;
			let usedFixedValue = false;
			if (this.nextFixedValue !== null) {
				value = this.nextFixedValue;
				usedFixedValue = true;
				// Check if this was from button 8 easter egg (value >= 8 and power of 2)
				const wasButton8 = value >= 8 && value <= 2048 && (value & (value - 1)) === 0;
				this.nextFixedValue = null; // Reset after use
				// Reset button 8 display value if it was used
				if (wasButton8) {
					this.fixed8DisplayValue = 8;
				}
				// Use requestAnimationFrame to update button state after DOM updates
				// This prevents visual flickering by batching the update
				requestAnimationFrame(() => {
					this.updateFixedValueButtons();
				});
			} else {
				value = Math.random() < 0.9 ? 2 : 4;
			}

			// Detect cheating: if used fixed value >= 8 or selected cell position
			if (!this.isCheating) {
				if (usedFixedValue && value >= 8) {
					this.isCheating = true;
				} else if (usedSelectedCell) {
					this.isCheating = true;
				}
			}

			const tileId = this.nextTileId++;

			const tile = {
				id: tileId,
				value: value,
				row: r,
				col: c,
				isNew: isNew,
				mergedFrom: null
			};

			this.tiles.set(tileId, tile);
			this.grid[r][c] = tileId;
		}
	}

	async move(direction) {
		this.enqueueMove(direction);
	}

	enqueueMove(direction) {
		this.inputQueue.push(direction);
		this.processInputQueue();
	}

	async processInputQueue() {
		if (this.isMoving || this.inputQueue.length === 0) return;

		this.isMoving = true;
		const direction = this.inputQueue.shift();

		try {
			this.saveStateToHistory();
			const moveResult = this.calculateMove(direction);

			if (!moveResult.moved) {
				this.history.pop();
				this.updateUndoButton();
				this.isMoving = false;
				this.processInputQueue();
				return;
			}

			this.animating = true;

			// Stage 1: Movement
			this.renderTilesForMovement(moveResult.mergeInfo);

			// Core delay for move animation (aligned with CSS 0.08s)
			await new Promise(resolve => setTimeout(resolve, 80));

			// Stage 2 & 3 Combined: Merge Logic + New Tile + Single Render
			moveResult.tilesToRemove.forEach(id => {
				const tile = this.tiles.get(id);
				if (tile) tile.toRemove = true;
			});

			this.performMerges(moveResult.mergeInfo);
			this.cleanupMergedTiles();

			// Add new tile BEFORE rendering so it appears in the same frame as the merge
			this.addRandomTile();

			// Single consolidated render
			this.renderTiles();

			// Fix: clear mergedFrom flags after render so they don't persist across moves
			this.tiles.forEach(tile => { tile.mergedFrom = null; });

			if (this.selectedCell && this.grid[this.selectedCell.row][this.selectedCell.col] !== null) {
				this.clearSelectedCell();
			}

			this.updateScore();
			this.saveGameState();
			this.updateUndoButton();
		} finally {
			this.animating = false;
			this.isMoving = false;
			this.checkGameOver();
			// Process next input in queue immediately for continuity
			this.processInputQueue();
		}
	}

	calculateMove(direction) {
		let moved = false;
		const tilesToRemove = [];
		const mergeInfo = []; // Track merge operations for animation
		const tilePositionUpdates = new Map(); // Store position updates without modifying tiles yet

		// Create a copy of the grid to track movements
		const newGrid = Array(this.gridSize).fill(null).map(() => Array(this.gridSize).fill(null));

		if (direction === 'left' || direction === 'right') {
			for (let r = 0; r < this.gridSize; r++) {
				const result = this.processLine(r, direction === 'right', true, tilePositionUpdates);
				if (result.moved) moved = true;
				tilesToRemove.push(...result.tilesToRemove);
				mergeInfo.push(...result.mergeInfo);

				// Update grid
				for (let c = 0; c < this.gridSize; c++) {
					newGrid[r][c] = result.line[c];
				}
			}
		} else {
			for (let c = 0; c < this.gridSize; c++) {
				const result = this.processLine(c, direction === 'down', false, tilePositionUpdates);
				if (result.moved) moved = true;
				tilesToRemove.push(...result.tilesToRemove);
				mergeInfo.push(...result.mergeInfo);

				// Update grid
				for (let r = 0; r < this.gridSize; r++) {
					newGrid[r][c] = result.line[r];
				}
			}
		}

		// Apply position updates to tiles
		tilePositionUpdates.forEach((pos, tileId) => {
			const tile = this.tiles.get(tileId);
			if (tile) {
				tile.row = pos.row;
				tile.col = pos.col;
				tile.isNew = false;
			}
		});

		// DON'T mark tiles for removal yet - let them animate first
		// Store the list for later cleanup
		this.grid = newGrid;
		return { moved, mergeInfo, tilesToRemove };
	}

	processLine(index, reverse, isRow, tilePositionUpdates) {
		// Extract line
		let line = [];
		for (let i = 0; i < this.gridSize; i++) {
			const tileId = isRow ? this.grid[index][i] : this.grid[i][index];
			if (tileId !== null) {
				line.push(tileId);
			}
		}

		if (reverse) line.reverse();

		let moved = false;
		const tilesToRemove = [];
		const newLine = [];
		const mergeInfo = []; // Track merges for animation

		// Merge tiles
		for (let i = 0; i < line.length; i++) {
			const currentId = line[i];
			const currentTile = this.tiles.get(currentId);

			if (i < line.length - 1) {
				const nextId = line[i + 1];
				const nextTile = this.tiles.get(nextId);

				if (currentTile.value === nextTile.value) {
					// Merge tiles - this is always a valid move
					moved = true;

					const newValue = currentTile.value * 2;
					const newTileId = this.nextTileId++;

					// Calculate target position where merge will happen
					const pos = reverse ? this.gridSize - 1 - newLine.length : newLine.length;
					const targetRow = isRow ? index : pos;
					const targetCol = isRow ? pos : index;

					// Store position updates instead of modifying tiles directly
					tilePositionUpdates.set(currentId, { row: targetRow, col: targetCol });
					tilePositionUpdates.set(nextId, { row: targetRow, col: targetCol });

					// Create merged tile at TARGET position (not source position)
					// This tile will be hidden initially and shown after source tiles arrive
					const mergedTile = {
						id: newTileId,
						value: newValue,
						row: targetRow,  // Start at target position
						col: targetCol,
						isNew: false,
						mergedFrom: [currentId, nextId],
						hidden: true  // Hide until source tiles arrive
					};

					this.tiles.set(newTileId, mergedTile);
					newLine.push(newTileId);
					tilesToRemove.push(currentId, nextId);

					// Record merge info for animation
					mergeInfo.push({
						newTileId,
						sourceTiles: [currentId, nextId],
						targetRow,
						targetCol,
						newValue
					});

					this.score += newValue;

					// Check for win - disabled, continue playing after reaching 2048
					// if (newValue === 2048 && !this.won) {
					// 	this.won = true;
					// 	setTimeout(() => this.showWinMessage(), 500);
					// }

					i++; // Skip next tile
					continue;
				}
			}

			newLine.push(currentId);
		}

		// Calculate new positions
		const finalLine = Array(this.gridSize).fill(null);
		for (let i = 0; i < newLine.length; i++) {
			const pos = reverse ? this.gridSize - 1 - i : i;
			finalLine[pos] = newLine[i];

			const tile = this.tiles.get(newLine[i]);
			const newRow = isRow ? index : pos;
			const newCol = isRow ? pos : index;

			if (tile.row !== newRow || tile.col !== newCol) {
				moved = true;
			}

			// Store position update instead of modifying directly
			tilePositionUpdates.set(newLine[i], { row: newRow, col: newCol });
		}

		return { line: finalLine, moved, tilesToRemove, mergeInfo };
	}

	cleanupMergedTiles() {
		const toDelete = [];
		this.tiles.forEach((tile, id) => {
			if (tile.toRemove) {
				toDelete.push(id);
				// Remove DOM element BEFORE deleting from Map
				const element = document.getElementById(`tile-${id}`);
				if (element) element.remove();
			}
		});
		toDelete.forEach(id => this.tiles.delete(id));
	}

	renderTilesForMovement(mergeInfo) {
		// Calculate cell size - use offsetWidth for consistency
		const containerWidth = this.gridContainer.offsetWidth;
		// Get gap from computed style (supports responsive gap, iOS Safari compatible)
		const gap = this.parseGap();
		const cellSize = (containerWidth - (this.gridSize - 1) * gap) / this.gridSize;

		// Debug: log gap and cellSize on iOS (can be removed later)
		if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
			console.log('iOS Debug - Gap:', gap, 'CellSize:', cellSize, 'ContainerWidth:', containerWidth);
		}

		// Render all tiles except hidden merged tiles
		this.tiles.forEach((tile, id) => {
			// Skip hidden merged tiles - they'll appear after source tiles arrive
			if (tile.hidden) return;

			let tileElement = document.getElementById(`tile-${id}`);

			if (!tileElement) {
				// Create new tile element
				tileElement = document.createElement('div');
				tileElement.id = `tile-${id}`;
				tileElement.className = `tile tile-${tile.value > 2048 ? 'super' : tile.value}`;
				tileElement.textContent = tile.value;
				tileElement.style.width = `${cellSize}px`;
				tileElement.style.height = `${cellSize}px`;

				if (tile.isNew) {
					tileElement.classList.add('tile-new');
				}

				this.tileContainer.appendChild(tileElement);
			}

			// Update position - all tiles move to their target positions
			tileElement.style.left = `${tile.col * (cellSize + gap)}px`;
			tileElement.style.top = `${tile.row * (cellSize + gap)}px`;
		});
	}

	performMerges(mergeInfo) {
		// Unhide merged tiles - they're already at the correct position
		mergeInfo.forEach(merge => {
			const mergedTile = this.tiles.get(merge.newTileId);
			if (mergedTile) {
				mergedTile.hidden = false;
			}
		});
	}

	renderTiles() {
		// Calculate cell size - use offsetWidth for consistency
		const containerWidth = this.gridContainer.offsetWidth;
		// Get gap from computed style (supports responsive gap, iOS Safari compatible)
		const gap = this.parseGap();
		const cellSize = (containerWidth - (this.gridSize - 1) * gap) / this.gridSize;

		// Debug: log gap and cellSize on iOS (can be removed later)
		if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
			console.log('iOS Debug - Gap:', gap, 'CellSize:', cellSize, 'ContainerWidth:', containerWidth);
		}

		// Update existing tiles or create new ones
		this.tiles.forEach((tile, id) => {
			// Skip hidden tiles (merged tiles not yet revealed)
			if (tile.hidden) return;

			let tileElement = document.getElementById(`tile-${id}`);

			if (!tileElement) {
				// Create new tile element
				tileElement = document.createElement('div');
				tileElement.id = `tile-${id}`;
				tileElement.className = `tile tile-${tile.value > 2048 ? 'super' : tile.value}`;
				tileElement.textContent = tile.value;
				tileElement.style.width = `${cellSize}px`;
				tileElement.style.height = `${cellSize}px`;

				if (tile.isNew) {
					tileElement.classList.add('tile-new');
				}

				this.tileContainer.appendChild(tileElement);
			}

			// Update position
			tileElement.style.left = `${tile.col * (cellSize + gap)}px`;
			tileElement.style.top = `${tile.row * (cellSize + gap)}px`;

			// Update value and class if merged
			if (tile.mergedFrom) {
				tileElement.className = `tile tile-${tile.value > 2048 ? 'super' : tile.value} tile-merged`;
				tileElement.textContent = tile.value;
			}
		});
	}

	updateScore() {
		// Update score
		this.scoreElement.textContent = this.score;

		// Add underline style if cheating
		if (this.isCheating) {
			this.scoreElement.classList.add('cheating-score');
		} else {
			this.scoreElement.classList.remove('cheating-score');
		}

		// Update best score only if not cheating
		if (!this.isCheating && this.score > this.bestScore) {
			this.bestScore = this.score;
			this.bestScoreElement.textContent = this.bestScore;
			this.saveBestScore();
		}
	}

	checkGameOver() {
		// Check if there are any empty cells
		for (let r = 0; r < this.gridSize; r++) {
			for (let c = 0; c < this.gridSize; c++) {
				if (this.grid[r][c] === null) return;
			}
		}

		// Check if any adjacent cells can be merged
		for (let r = 0; r < this.gridSize; r++) {
			for (let c = 0; c < this.gridSize; c++) {
				const currentId = this.grid[r][c];
				if (currentId === null) continue;

				const currentTile = this.tiles.get(currentId);
				if (!currentTile) continue;

				// Check right neighbor
				if (c < this.gridSize - 1) {
					const rightId = this.grid[r][c + 1];
					if (rightId !== null) {
						const rightTile = this.tiles.get(rightId);
						if (rightTile && currentTile.value === rightTile.value) {
							return; // Can merge, game continues
						}
					}
				}

				// Check bottom neighbor
				if (r < this.gridSize - 1) {
					const bottomId = this.grid[r + 1][c];
					if (bottomId !== null) {
						const bottomTile = this.tiles.get(bottomId);
						if (bottomTile && currentTile.value === bottomTile.value) {
							return; // Can merge, game continues
						}
					}
				}
			}
		}

		// Game over
		this.gameOver = true;
		this.saveToHistory();
		setTimeout(() => this.showGameOverMessage(), 300);
	}

	showGameOverMessage() {
		this.gameMessage.querySelector('p').textContent = '游戏结束！';
		this.gameMessage.classList.add('show');
		// Update undo button state in game over message
		this.updateUndoButton();
	}

	showWinMessage() {
		this.gameMessage.querySelector('p').textContent = '你赢了！';
		this.gameMessage.classList.add('show');
	}

	hideMessage() {
		this.gameMessage.classList.remove('show');
		this.updateUndoButton();
	}

	// Storage adapter - supports both Chrome Extension and regular web
	isChromeExtension() {
		return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
	}

	// Chrome Storage Methods
	// Throttled auto-save: during normal play, save at most once every autoSaveInterval (30s)
	saveGameState() {
		const now = Date.now();

		// First save in this session: save immediately
		if (!this.lastAutoSaveTime) {
			this.lastAutoSaveTime = now;
			this.saveGameStateImmediate();
			return;
		}

		const elapsed = now - this.lastAutoSaveTime;

		// Only auto-save if interval has passed
		if (elapsed >= this.autoSaveInterval) {
			this.lastAutoSaveTime = now;
			this.saveGameStateImmediate();
		}
		// Otherwise, do nothing and rely on the next call or unload handler
	}

	// Immediate save: actually performs the save operation
	async saveGameStateImmediate() {
		// Fix: validate state before saving to prevent persisting ghost tiles
		this.validateAndHealState();

		// Fix: filter out any residual transient-state tiles (toRemove / hidden)
		// and deep-copy grid so async Chrome storage write gets a stable snapshot
		const tilesArray = Array.from(this.tiles.entries())
			.filter(([, tile]) => !tile.toRemove && !tile.hidden)
			.map(([id, tile]) => ({
				id,
				value: tile.value,
				row: tile.row,
				col: tile.col
			}));

		const gameState = {
			grid: this.grid.map(row => [...row]), // Fix: deep-copy to avoid reference mutation during async write
			tiles: tilesArray,
			nextTileId: this.nextTileId,
			score: this.score,
			gameOver: this.gameOver,
			won: this.won,
			history: this.history, // Save history for undo functionality
			isCheating: this.isCheating // Persist cheating flag
		};

		if (this.isChromeExtension()) {
			return new Promise((resolve) => {
				chrome.storage.local.set({ gameState }, resolve);
			});
		} else {
			// Use localStorage for regular web
			localStorage.setItem('gameState', JSON.stringify(gameState));
			return Promise.resolve();
		}
	}

	// Setup page unload handler to ensure state is saved before leaving
	setupUnloadHandler() {
		// Save immediately when page is about to unload
		const handleUnload = () => {
			// Use sendBeacon for reliable saving on page unload (if available)
			if (navigator.sendBeacon) {
				// For localStorage, we still need to use synchronous save
				// Chrome extension storage is async but we can't wait
				this.saveGameStateImmediate().catch(() => {
					// Fallback: try synchronous localStorage save
					try {
						const tilesArray = Array.from(this.tiles.entries()).map(([id, tile]) => ({
							id,
							value: tile.value,
							row: tile.row,
							col: tile.col
						}));

						const gameState = {
							grid: this.grid,
							tiles: tilesArray,
							nextTileId: this.nextTileId,
							score: this.score,
							gameOver: this.gameOver,
							won: this.won,
							history: this.history,
							isCheating: this.isCheating
						};

						if (!this.isChromeExtension()) {
							localStorage.setItem('gameState', JSON.stringify(gameState));
						}
					} catch (e) {
						console.error('Failed to save game state on unload:', e);
					}
				});
			} else {
				// Fallback for browsers without sendBeacon
				this.saveGameStateImmediate().catch(() => { });
			}
		};

		// Listen to multiple events to catch all unload scenarios
		window.addEventListener('beforeunload', handleUnload);
		window.addEventListener('pagehide', handleUnload);

		// For mobile Safari, also listen to visibilitychange
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				handleUnload();
			}
		});
	}

	async loadGameState() {
		if (this.isChromeExtension()) {
			return new Promise((resolve) => {
				chrome.storage.local.get(['gameState'], (result) => {
					if (result.gameState && result.gameState.tiles) {
						this.restoreGameState(result.gameState);
					} else {
						// Start new game if no saved state
						this.newGame();
					}
					resolve();
				});
			});
		} else {
			// Use localStorage for regular web
			const savedState = localStorage.getItem('gameState');
			if (savedState) {
				try {
					const gameState = JSON.parse(savedState);
					if (gameState && gameState.tiles) {
						this.restoreGameState(gameState);
					} else {
						this.newGame();
					}
				} catch (e) {
					console.error('Failed to load game state:', e);
					this.newGame();
				}
			} else {
				this.newGame();
			}
			return Promise.resolve();
		}
	}

	restoreGameState(gameState) {
		// Restore tiles from saved state
		this.grid = gameState.grid;
		this.nextTileId = gameState.nextTileId;
		this.score = gameState.score;
		this.gameOver = gameState.gameOver;
		this.won = gameState.won;
		this.isCheating = gameState.isCheating || false; // Restore cheating flag
		// Restore history if available, otherwise initialize empty array
		this.history = gameState.history || [];
		// Clear selected cell UI state (not persisted)
		this.selectedCell = null;
		this.lastClickedCell = null;

		// Reconstruct tiles Map
		this.tiles.clear();
		gameState.tiles.forEach(tileData => {
			this.tiles.set(tileData.id, {
				id: tileData.id,
				value: tileData.value,
				row: tileData.row,
				col: tileData.col,
				isNew: false,
				mergedFrom: null
			});
		});

		// Fix: heal any inconsistencies in restored state before rendering
		this.validateAndHealState();
		this.renderTiles();
		this.updateScore();
		this.updateUndoButton();
		this.updateSelectedCellDisplay();
	}

	async saveBestScore() {
		if (this.isChromeExtension()) {
			return new Promise((resolve) => {
				chrome.storage.local.set({ bestScore: this.bestScore }, resolve);
			});
		} else {
			localStorage.setItem('bestScore', this.bestScore.toString());
			return Promise.resolve();
		}
	}

	async loadBestScore() {
		if (this.isChromeExtension()) {
			return new Promise((resolve) => {
				chrome.storage.local.get(['bestScore'], (result) => {
					this.bestScore = result.bestScore || 0;
					this.bestScoreElement.textContent = this.bestScore;
					resolve();
				});
			});
		} else {
			const saved = localStorage.getItem('bestScore');
			this.bestScore = saved ? parseInt(saved, 10) : 0;
			this.bestScoreElement.textContent = this.bestScore;
			return Promise.resolve();
		}
	}

	async saveToHistory() {
		const historyItem = {
			score: this.score,
			date: new Date().toISOString(),
			timestamp: Date.now()
		};

		if (this.isChromeExtension()) {
			return new Promise((resolve) => {
				chrome.storage.local.get(['history'], (result) => {
					const history = result.history || [];
					history.unshift(historyItem);

					// Keep only last 20 records
					if (history.length > 20) {
						history.splice(20);
					}

					chrome.storage.local.set({ history }, resolve);
				});
			});
		} else {
			const historyStr = localStorage.getItem('history');
			const history = historyStr ? JSON.parse(historyStr) : [];
			history.unshift(historyItem);

			// Keep only last 20 records
			if (history.length > 20) {
				history.splice(20);
			}

			localStorage.setItem('history', JSON.stringify(history));
			return Promise.resolve();
		}
	}

	// Update Logic
	async checkForUpdates() {
		// Handle Chrome Extension environment
		if (this.isChromeExtension()) {
			this.showToast('正在检查扩展更新...', 'info');
			if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.requestUpdateCheck) {
				chrome.runtime.requestUpdateCheck((status) => {
					if (status === 'update_available') {
						this.showToast('扩展有新版本可用，请在管理页面更新', 'info');
					} else {
						this.showToast('扩展已是最新版本');
					}
				});
			} else {
				this.showToast('此环境不支持手动检查扩展更新');
			}
			return;
		}

		// Handle PWA/Web environment
		if (!('serviceWorker' in navigator)) {
			this.showToast('此浏览器不支持 PWA 自动更新');
			return;
		}

		if (this.isCheckingUpdates) return;
		this.isCheckingUpdates = true;

		this.showToast('正在检查 PWA 更新...', 'info');

		try {
			const registration = await navigator.serviceWorker.getRegistration();
			if (registration) {
				await registration.update();

				// If no update is found within 2 seconds, show "Already up to date"
				setTimeout(() => {
					if (this.isCheckingUpdates) {
						this.showToast('当前已是最新版本');
						this.isCheckingUpdates = false;
					}
				}, 2000);
			} else {
				this.showToast('未找到 Service Worker');
				this.isCheckingUpdates = false;
			}
		} catch (error) {
			console.error('Check update failed:', error);
			this.showToast('检查更新失败');
			this.isCheckingUpdates = false;
		}
	}

	checkPostUpdateStatus() {
		const lastVersion = localStorage.getItem('last_version');
		if (lastVersion && lastVersion !== APP_VERSION) {
			this.showToast(`升级成功！当前版本: ${APP_VERSION}`, 'success');
		}
		localStorage.setItem('last_version', APP_VERSION);
		if (this.appVersionElement) {
			this.appVersionElement.textContent = APP_VERSION;
		}
	}

	showToast(message, type = 'info') {
		const existingToast = document.getElementById('app-toast');
		if (existingToast) existingToast.remove();

		const toast = document.createElement('div');
		toast.id = 'app-toast';
		toast.style.cssText = `
			position: fixed;
			top: 20px;
			left: 50%;
			transform: translateX(-50%);
			background: ${type === 'success' ? '#4caf50' : type === 'warn' ? '#e65100' : 'rgba(0,0,0,0.8)'};
			color: white;
			padding: 12px 24px;
			border-radius: 8px;
			font-size: 16px;
			z-index: 10002;
			box-shadow: 0 4px 12px rgba(0,0,0,0.3);
			animation: slideDown 0.3s ease;
			pointer-events: none;
		`;
		toast.textContent = message;

		// Add animation style if not exists
		if (!document.getElementById('toast-style')) {
			const style = document.createElement('style');
			style.id = 'toast-style';
			style.textContent = `
				@keyframes slideDown {
					from { transform: translate(-50%, -100%); opacity: 0; }
					to { transform: translate(-50%, 0); opacity: 1; }
				}
			`;
			document.head.appendChild(style);
		}

		document.body.appendChild(toast);

		setTimeout(() => {
			toast.style.opacity = '0';
			toast.style.transition = 'opacity 0.5s ease';
			setTimeout(() => toast.remove(), 500);
		}, 3000);
	}

	// ── State Integrity Guard ─────────────────────────────────────────────────
	// Cross-validates this.grid (position index) and this.tiles (data map).
	// Detects and repairs any inconsistency regardless of its root cause.
	// Returns true if healing was needed (caller may choose to notify user).
	validateAndHealState() {
		let healedOrphan = false;    // tile in Map but not in grid
		let healedDeadRef = false;   // grid cell points to non-existent tile
		let healedPosMeta = false;   // tile.row/col disagrees with grid position
		let healedIdCounter = false; // nextTileId <= largest existing id

		// ── Pass 1: collect tile ids actually present in grid ────────────────
		const gridTileIds = new Set();
		for (let r = 0; r < this.gridSize; r++) {
			for (let c = 0; c < this.gridSize; c++) {
				const id = this.grid[r][c];
				if (id !== null) gridTileIds.add(id);
			}
		}

		// ── Pass 2: remove orphan / stale tiles from the Map ─────────────────
		// An orphan tile is one present in this.tiles but absent from this.grid,
		// OR one still carrying a transient flag (toRemove / hidden) that should
		// have been cleaned up by cleanupMergedTiles / performMerges.
		const orphanIds = [];
		this.tiles.forEach((tile, id) => {
			if (!gridTileIds.has(id) || tile.toRemove || tile.hidden) {
				orphanIds.push(id);
			}
		});
		orphanIds.forEach(id => {
			const el = document.getElementById(`tile-${id}`);
			if (el) el.remove();
			this.tiles.delete(id);
			healedOrphan = true;
		});

		// ── Pass 3: fix grid cells that reference missing tile ids ───────────
		for (let r = 0; r < this.gridSize; r++) {
			for (let c = 0; c < this.gridSize; c++) {
				const id = this.grid[r][c];
				if (id !== null && !this.tiles.has(id)) {
					this.grid[r][c] = null;
					healedDeadRef = true;
				}
			}
		}

		// ── Pass 4: fix tile row/col metadata that disagrees with grid ───────
		this.tiles.forEach((tile, id) => {
			if (this.grid[tile.row]?.[tile.col] !== id) {
				// Scan grid to find where this tile actually lives
				let found = false;
				for (let r = 0; r < this.gridSize && !found; r++) {
					for (let c = 0; c < this.gridSize && !found; c++) {
						if (this.grid[r][c] === id) {
							tile.row = r;
							tile.col = c;
							found = true;
							healedPosMeta = true;
						}
					}
				}
				// If not found in grid at all, it was already removed in Pass 2/3;
				// nothing more to do here.
			}
		});

		// ── Pass 5: clean residual transient flags on surviving tiles ────────
		this.tiles.forEach(tile => {
			tile.mergedFrom = null;
			tile.isNew = false;
			delete tile.toRemove;
			delete tile.hidden;
		});

		// ── Pass 6: ensure nextTileId is strictly above all existing ids ─────
		let maxId = 0;
		this.tiles.forEach((_, id) => { if (id > maxId) maxId = id; });
		if (this.nextTileId <= maxId) {
			this.nextTileId = maxId + 1;
			healedIdCounter = true;
		}

		// ── Report & notify ──────────────────────────────────────────────────
		const anyHealed = healedOrphan || healedDeadRef || healedPosMeta || healedIdCounter;
		if (anyHealed) {
			const details = [
				healedOrphan ? '清除孤立方块' : null,
				healedDeadRef ? '修复断裂索引' : null,
				healedPosMeta ? '修正位置元数据' : null,
				healedIdCounter ? '修正ID计数器' : null
			].filter(Boolean).join('、');
			console.warn(`[2048] 状态自愈触发 (${details})`);
			this.showToast(`⚠️ 检测到状态异常，已自动修复（${details}）`, 'warn');
		}
		return anyHealed;
	}

}

// Show update notification when new version is available
function showUpdateNotification() {
	// Remove existing notification if any
	const existing = document.getElementById('update-notification');
	if (existing) existing.remove();

	// Create update notification
	const notification = document.createElement('div');
	notification.id = 'update-notification';
	notification.style.cssText = `
		position: fixed;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(76, 175, 80, 0.95);
		color: white;
		padding: 16px 24px;
		border-radius: 12px;
		font-size: 20px;
		z-index: 10000;
		font-family: 'Arial', 'Helvetica', 'Roboto', 'Segoe UI', 'Montserrat', sans-serif;
		box-shadow: 0 4px 12px rgba(0,0,0,0.4);
		display: flex;
		align-items: center;
		gap: 16px;
		max-width: 90%;
	`;

	notification.innerHTML = `
		<div style="flex: 1;">
			<strong>🔄 新版本可用</strong><br>
			<span style="font-size: 16px; opacity: 0.9;">点击刷新以获取最新版本</span>
		</div>
		<button id="update-refresh-btn" style="
			background: white;
			color: #4caf50;
			border: none;
			padding: 8px 16px;
			border-radius: 6px;
			font-weight: bold;
			cursor: pointer;
			font-size: 18px;
		">刷新</button>
	`;

	// Add refresh button click handler
	const refreshBtn = notification.querySelector('#update-refresh-btn');
	refreshBtn.addEventListener('click', () => {
		window.location.reload();
	});

	document.body.appendChild(notification);

	// Auto-hide after 10 seconds
	setTimeout(() => {
		if (notification.parentNode) {
			notification.style.opacity = '0';
			notification.style.transition = 'opacity 0.3s';
			setTimeout(() => notification.remove(), 300);
		}
	}, 10000);
}

// Hide browser address bar on mobile devices
// function hideAddressBar() {
// 	// Only on mobile devices
// 	if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
// 		// Set viewport height to window height (prevents address bar from showing)
// 		const setViewportHeight = () => {
// 			const vh = window.innerHeight * 0.01;
// 			document.documentElement.style.setProperty('--vh', `${vh}px`);
// 		};
//
// 		setViewportHeight();
// 		window.addEventListener('resize', setViewportHeight);
// 		window.addEventListener('orientationchange', () => {
// 			setTimeout(setViewportHeight, 100);
// 		});

// 		// Method 1: Force scroll to hide address bar (works on most browsers)
// 		const scrollToHide = () => {
// 			// Only scroll if page is at top
// 			if (window.scrollY === 0) {
// 				window.scrollTo(0, 1);
// 				setTimeout(() => {
// 					window.scrollTo(0, 0);
// 				}, 10);
// 			}
// 		};

// 		// Try multiple times with delays
// 		setTimeout(scrollToHide, 0);
// 		setTimeout(scrollToHide, 100);
// 		setTimeout(scrollToHide, 300);
// 		setTimeout(scrollToHide, 500);

// 		// Also try on touch events
// 		let touchCount = 0;
// 		const handleTouch = () => {
// 			if (touchCount < 3 && window.scrollY === 0) {
// 				window.scrollTo(0, 1);
// 				setTimeout(() => {
// 					window.scrollTo(0, 0);
// 				}, 10);
// 				touchCount++;
// 			}
// 		};
// 		document.addEventListener('touchstart', handleTouch, { passive: true });
// 	}
// }

// Check PWA installation status and display mode
// function checkPWAStatus() {
// 	const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
// 	const isFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
// 	const isMinimalUI = window.matchMedia('(display-mode: minimal-ui)').matches;
// 	const isInstalled = window.navigator.standalone || isStandalone || isFullscreen || isMinimalUI;
//
// 	const status = {
// 		isStandalone,
// 		isFullscreen,
// 		isMinimalUI,
// 		isInstalled,
// 		displayMode: isStandalone ? 'standalone' : isFullscreen ? 'fullscreen' : isMinimalUI ? 'minimal-ui' : 'browser',
// 		userAgent: navigator.userAgent,
// 		platform: navigator.platform,
// 		windowMode: window.matchMedia('(display-mode: standalone)').media,
// 		innerHeight: window.innerHeight,
// 		outerHeight: window.outerHeight,
// 		screenHeight: screen.height,
// 		hasAddressBar: window.outerHeight > window.innerHeight + 50 // Rough estimate
// 	};
//
// 	// Log status for debugging
// 	console.log('=== PWA Status Check ===');
// 	console.log('Is Installed:', status.isInstalled);
// 	console.log('Display Mode:', status.displayMode);
// 	console.log('Is Standalone:', status.isStandalone);
// 	console.log('User Agent:', status.userAgent);
// 	console.log('Platform:', status.platform);
// 	console.log('Window innerHeight:', status.innerHeight);
// 	console.log('Window outerHeight:', status.outerHeight);
// 	console.log('Screen height:', status.screenHeight);
// 	console.log('Has Address Bar (estimated):', status.hasAddressBar);
// 	console.log('========================');
//
// 	// Show visual indicator on page (only on mobile)
// 	if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
// 		showPWAStatusIndicator(status);
// 	}
//
// 	// Show warning if not in standalone mode
// 	if (!status.isInstalled && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
// 		console.warn('⚠️ PWA is not running in standalone mode. Address bar may be visible.');
// 		console.warn('This might be due to:');
// 		console.warn('1. Opening from browser instead of home screen icon');
// 		console.warn('2. PWA not properly installed');
// 		console.warn('3. Android/Chrome version limitations');
// 		console.warn('');
// 		console.warn('📱 To fix this:');
// 		console.warn('1. Make sure you opened the app from the HOME SCREEN ICON');
// 		console.warn('2. If no icon exists, install PWA:');
// 		console.warn('   - Chrome menu (3 dots) → "Add to Home screen" or "Install app"');
// 		console.warn('3. Then open from the home screen icon (not from browser)');
// 	}
//
// 	return status;
// }

// Show PWA status indicator on page
// function showPWAStatusIndicator(status) {
// 	// Remove existing indicator if any
// 	const existing = document.getElementById('pwa-status-indicator');
// 	if (existing) existing.remove();
//
// 	// Create status indicator
// 	const indicator = document.createElement('div');
// 	indicator.id = 'pwa-status-indicator';
// 	const isOK = status.isStandalone || status.isFullscreen;
// 	indicator.style.cssText = `
// 		position: fixed;
// 		top: 10px;
// 		right: 10px;
// 		background: ${isOK ? 'rgba(76, 175, 80, 0.95)' : 'rgba(244, 67, 54, 0.95)'};
// 		color: white;
// 		padding: 10px 14px;
// 		border-radius: 8px;
// 		font-size: 12px;
// 		z-index: 10000;
// 		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
// 		box-shadow: 0 4px 12px rgba(0,0,0,0.4);
// 		max-width: 280px;
// 		line-height: 1.5;
// 	`;
//
// 	let installInstructions = '';
// 	if (!status.isInstalled) {
// 		installInstructions = `
// 			<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.3); font-size: 11px;">
// 				<strong>📱 安装步骤：</strong><br>
// 				1. 点击浏览器菜单（右上角3点）<br>
// 				2. 选择"添加到主屏幕"<br>
// 				3. 从主屏幕图标打开（不要从浏览器打开）
// 			</div>
// 		`;
// 	}
//
// 	indicator.innerHTML = `
// 		<div style="font-weight: bold; margin-bottom: 6px;">PWA 状态</div>
// 		<div>模式: <strong>${status.displayMode}</strong></div>
// 		<div>已安装: ${status.isInstalled ? '✓ 是' : '✗ 否'}</div>
// 		<div>地址栏: ${status.hasAddressBar ? '可见' : '隐藏'}</div>
// 		${installInstructions}
// 		<div style="margin-top: 8px; font-size: 10px; opacity: 0.9; text-align: center;">
// 			点击关闭
// 		</div>
// 	`;
//
// 	// Add click to close
// 	indicator.addEventListener('click', () => {
// 		indicator.style.opacity = '0';
// 		indicator.style.transition = 'opacity 0.3s';
// 		setTimeout(() => indicator.remove(), 300);
// 	});
//
// 	// Auto-hide after 10 seconds (longer if not installed)
// 	setTimeout(() => {
// 		if (indicator.parentNode) {
// 			indicator.style.opacity = '0';
// 			indicator.style.transition = 'opacity 0.5s';
// 			setTimeout(() => indicator.remove(), 500);
// 		}
// 	}, status.isInstalled ? 5000 : 10000);
//
// 	document.body.appendChild(indicator);
// }

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
	// Check PWA status first
	// const pwaStatus = checkPWAStatus();

	new Game2048();

	// Hide address bar on mobile (only if not in standalone mode)
	// if (!pwaStatus.isStandalone) {
	// 	hideAddressBar();
	// }
});

// Check PWA installability
// async function checkPWAInstallability() {
// 	const checks = {
// 		hasManifest: false,
// 		manifestValid: false,
// 		hasServiceWorker: false,
// 		serviceWorkerRegistered: false,
// 		isHTTPS: location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1',
// 		hasIcons: false,
// 		serviceWorkerError: null,
// 		serviceWorkerReason: null,
// 		isSecureContext: window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
// 	};
//
// 	// Check Service Worker support (more detailed check)
// 	try {
// 		if ('serviceWorker' in navigator) {
// 			checks.hasServiceWorker = true;
// 		} else {
// 			checks.hasServiceWorker = false;
// 			checks.serviceWorkerReason = 'navigator.serviceWorker 不存在';
//
// 			// Check if it's a security context issue
// 			if (!checks.isSecureContext && location.protocol !== 'https:') {
// 				checks.serviceWorkerReason = '需要HTTPS或localhost（当前使用HTTP）';
// 			} else if (window.parent !== window) {
// 				checks.serviceWorkerReason = '在iframe中运行，Service Worker可能不可用';
// 			} else {
// 				checks.serviceWorkerReason = '浏览器不支持Service Worker';
// 			}
// 		}
// 	} catch (e) {
// 		checks.hasServiceWorker = false;
// 		checks.serviceWorkerReason = '检查Service Worker支持时出错: ' + e.message;
// 	}
//
// 	// Check manifest
// 	try {
// 		const manifestLink = document.querySelector('link[rel="manifest"]');
// 		if (manifestLink) {
// 			checks.hasManifest = true;
// 			const manifestUrl = manifestLink.href;
// 			const response = await fetch(manifestUrl);
// 			if (response.ok) {
// 				const manifest = await response.json();
// 				checks.manifestValid = !!manifest.name && !!manifest.start_url && !!manifest.icons;
// 				checks.hasIcons = manifest.icons && manifest.icons.length > 0;
// 			}
// 		}
// 	} catch (e) {
// 		console.error('Manifest check failed:', e);
// 		checks.manifestError = e.message;
// 	}
//
// 	// Check Service Worker registration
// 	if (checks.hasServiceWorker) {
// 		try {
// 			const registration = await navigator.serviceWorker.getRegistration();
// 			checks.serviceWorkerRegistered = !!registration;
// 		} catch (e) {
// 			console.error('Service Worker check failed:', e);
// 			checks.serviceWorkerError = e.message;
// 		}
// 	}
//
// 	console.log('=== PWA Installability Check ===');
// 	console.log('Has Manifest:', checks.hasManifest);
// 	console.log('Manifest Valid:', checks.manifestValid);
// 	console.log('Has Service Worker Support:', checks.hasServiceWorker);
// 	console.log('Service Worker Registered:', checks.serviceWorkerRegistered);
// 	console.log('Is HTTPS/localhost:', checks.isHTTPS);
// 	console.log('Is Secure Context:', checks.isSecureContext);
// 	console.log('Has Icons:', checks.hasIcons);
// 	if (checks.serviceWorkerReason) {
// 		console.log('Service Worker Reason:', checks.serviceWorkerReason);
// 	}
// 	console.log('===============================');
//
// 	// Show issues
// 	const issues = [];
// 	if (!checks.hasManifest) issues.push('❌ Manifest文件未找到');
// 	if (!checks.manifestValid) issues.push('❌ Manifest配置无效');
// 	if (!checks.hasServiceWorker) {
// 		issues.push(`❌ Service Worker不可用: ${checks.serviceWorkerReason || '未知原因'}`);
// 	}
// 	if (checks.hasServiceWorker && !checks.serviceWorkerRegistered) {
// 		issues.push('❌ Service Worker未注册（可能正在注册中，请稍候）');
// 	}
// 	if (checks.serviceWorkerError) issues.push(`❌ Service Worker错误: ${checks.serviceWorkerError}`);
// 	if (!checks.isHTTPS && /Android/i.test(navigator.userAgent)) {
// 		// Android Chrome supports HTTP, but some versions may require HTTPS
// 		if (!checks.hasServiceWorker) {
// 			issues.push('⚠️ 使用HTTPS可能解决Service Worker问题（当前使用HTTP）');
// 		}
// 	}
// 	if (!checks.hasIcons) issues.push('❌ Manifest中缺少图标配置');
//
// 	if (issues.length > 0) {
// 		console.warn('PWA安装条件检查发现问题：');
// 		issues.forEach(issue => console.warn(issue));
// 		console.warn('');
// 		console.warn('这可能导致只能"创建快捷方式"而不是"安装应用"');
// 	}
//
// 	// Show on page for mobile users
// 	if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
// 		showPWAInstallabilityIndicator(checks, issues);
// 	}
//
// 	return checks;
// }

// Show PWA installability indicator on page
// function showPWAInstallabilityIndicator(checks, issues) {
// 	// Remove existing indicator if any
// 	const existing = document.getElementById('pwa-installability-indicator');
// 	if (existing) existing.remove();
//
// 	// Only show if there are issues
// 	if (issues.length === 0) return;
//
// 	// Create indicator
// 	const indicator = document.createElement('div');
// 	indicator.id = 'pwa-installability-indicator';
// 	indicator.style.cssText = `
// 		position: fixed;
// 		bottom: 10px;
// 		left: 10px;
// 		right: 10px;
// 		background: rgba(255, 152, 0, 0.95);
// 		color: white;
// 		padding: 12px 16px;
// 		border-radius: 8px;
// 		font-size: 12px;
// 		z-index: 10001;
// 		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
// 		box-shadow: 0 4px 12px rgba(0,0,0,0.4);
// 		line-height: 1.6;
// 		max-height: 60vh;
// 		overflow-y: auto;
// 	`;
//
// 	let issuesHtml = issues.map(issue => `<div>${issue}</div>`).join('');
//
// 	indicator.innerHTML = `
// 		<div style="font-weight: bold; margin-bottom: 8px; font-size: 13px;">
// 			⚠️ PWA安装问题诊断
// 		</div>
// 		<div style="margin-bottom: 8px;">
// 			${issuesHtml}
// 		</div>
// 		<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.3); font-size: 11px;">
// 			<strong>详细信息：</strong><br>
// 			Manifest: ${checks.hasManifest ? '✓' : '✗'} ${checks.manifestValid ? '(有效)' : '(无效)'}<br>
// 			Service Worker: ${checks.hasServiceWorker ? '✓' : '✗'} ${checks.serviceWorkerRegistered ? '(已注册)' : '(未注册)'}<br>
// 			${checks.serviceWorkerReason ? `原因: ${checks.serviceWorkerReason}<br>` : ''}
// 			HTTPS: ${checks.isHTTPS ? '✓' : '✗'} (当前: ${location.protocol})<br>
// 			安全上下文: ${checks.isSecureContext ? '✓' : '✗'}<br>
// 			Icons: ${checks.hasIcons ? '✓' : '✗'}
// 		</div>
// 		<div style="margin-top: 8px; font-size: 10px; opacity: 0.9; text-align: center;">
// 			点击关闭
// 		</div>
// 	`;
//
// 	// Add click to close
// 	indicator.addEventListener('click', () => {
// 		indicator.style.opacity = '0';
// 		indicator.style.transition = 'opacity 0.3s';
// 		setTimeout(() => indicator.remove(), 300);
// 	});
//
// 	// Auto-hide after 15 seconds
// 	setTimeout(() => {
// 		if (indicator.parentNode) {
// 			indicator.style.opacity = '0';
// 			indicator.style.transition = 'opacity 0.5s';
// 			setTimeout(() => indicator.remove(), 500);
// 		}
// 	}, 15000);
//
// 	document.body.appendChild(indicator);
// }

// Also hide address bar after page fully loads
window.addEventListener('load', async () => {
	// hideAddressBar();

	// Check PWA installability
	// await checkPWAInstallability();

	// Register Service Worker for PWA (moved from inline script to fix CSP)
	if ('serviceWorker' in navigator) {
		// Use relative path for service worker
		const swPath = './sw.js';
		navigator.serviceWorker.register(swPath)
			.then((registration) => {
				// console.log('✅ Service Worker registered successfully:', registration);

				// Check for updates periodically
				setInterval(() => {
					registration.update();
				}, 60000); // Check every minute

				// Listen for updates
				registration.addEventListener('updatefound', () => {
					const newWorker = registration.installing;
					if (newWorker) {
						newWorker.addEventListener('statechange', () => {
							if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
								// New service worker available, show update notification
								if (this.isCheckingUpdates) {
									this.isCheckingUpdates = false;
								}
								showUpdateNotification();
							}
						});
					}
				});
			})
			.catch((error) => {
				// console.error('❌ Service Worker registration failed:', error);
				// console.error('这可能导致PWA无法安装，只能创建快捷方式');
			});

		// Listen for controller change (when new service worker takes control)
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			// Reload page to get new version
			window.location.reload();
		});
	} else {
		// console.warn('⚠️ 浏览器不支持Service Worker');
	}
});
