// 2048 Game Logic with Chrome Storage Integration and Animations

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

		this.gridContainer = document.getElementById('grid-container');
		this.tileContainer = document.getElementById('tile-container');
		this.scoreElement = document.getElementById('score');
		this.bestScoreElement = document.getElementById('best-score');
		this.gameMessage = document.getElementById('game-message');
		this.undoBtn = document.getElementById('undo-btn');
		this.undoFromGameOverBtn = document.getElementById('undo-from-gameover');
		this.fixed4Btn = document.getElementById('fixed-4-btn');
		this.fixed8Btn = document.getElementById('fixed-8-btn');

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
	}

	createGrid() {
		// Create grid cells
		for (let i = 0; i < this.gridSize * this.gridSize; i++) {
			const cell = document.createElement('div');
			cell.className = 'grid-cell';
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
			this.setNextFixedValue(4);
		});

		this.fixed8Btn.addEventListener('click', () => {
			this.setNextFixedValue(8);
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

	}

	setupTouchControls() {
		let touchStartX = null;
		let touchStartY = null;
		const minSwipeDistance = 30; // Minimum distance for a swipe

		const gameContainer = document.querySelector('.game-container');
		const swipeArea = document.querySelector('.swipe-area');
		const touchTargets = [gameContainer, swipeArea].filter(el => el !== null);

		// Prevent pull-to-refresh on mobile when touching game container
		let isTouchingGameContainer = false;
		let touchStartYGlobal = null;

		// Helper function to handle touch start
		const handleTouchStart = (e) => {
			isTouchingGameContainer = true;
			touchStartYGlobal = e.touches[0].clientY;
			
			if (this.gameOver || this.animating) return;
			const firstTouch = e.touches[0];
			touchStartX = firstTouch.clientX;
			touchStartY = firstTouch.clientY;
		};

		// Helper function to handle touch end
		const handleTouchEnd = async (e) => {
			if (this.gameOver || this.animating || touchStartX === null || touchStartY === null) return;

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
		};

		// Helper function to handle touch end (for pull-to-refresh prevention)
		const handleTouchEndCleanup = () => {
			isTouchingGameContainer = false;
			touchStartYGlobal = null;
		};

		// Add event listeners to all touch targets
		touchTargets.forEach(target => {
			target.addEventListener('touchstart', handleTouchStart, { passive: true });
			target.addEventListener('touchend', handleTouchEnd, { passive: false });
			target.addEventListener('touchend', handleTouchEndCleanup, { passive: true });
			target.addEventListener('touchcancel', handleTouchEndCleanup, { passive: true });
		});

		document.addEventListener('touchmove', (e) => {
			// Prevent pull-to-refresh when touching game container and scrolling down from top
			if (isTouchingGameContainer && touchStartYGlobal !== null) {
				const currentY = e.touches[0].clientY;
				const deltaY = currentY - touchStartYGlobal;
				
				// If at top of page and scrolling down, prevent pull-to-refresh
				if (window.scrollY === 0 && deltaY > 0) {
					e.preventDefault();
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
		this.updateFixedValueButtons(); // Update button states

		// Start new game
		this.addRandomTile();
		this.addRandomTile();
		this.renderTiles();
		this.updateScore();
		this.updateUndoButton();
		this.saveGameState();
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
			won: this.won
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

		// Render tiles and update UI
		this.renderTiles();
		this.updateScore();
		this.updateUndoButton();
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
		// Set the fixed value for the next random tile
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
			const shouldBeActive = this.nextFixedValue === 8;
			const isActive = this.fixed8Btn.classList.contains('active');
			
			// Only update if state changed
			if (shouldBeActive && !isActive) {
				this.fixed8Btn.classList.add('active');
			} else if (!shouldBeActive && isActive) {
				this.fixed8Btn.classList.remove('active');
			}
		}
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
			const { r, c } = emptyCells[Math.floor(Math.random() * emptyCells.length)];
			
			// Use fixed value if set, otherwise use normal random logic
			let value;
			if (this.nextFixedValue !== null) {
				value = this.nextFixedValue;
				this.nextFixedValue = null; // Reset after use
				// Use requestAnimationFrame to update button state after DOM updates
				// This prevents visual flickering by batching the update
				requestAnimationFrame(() => {
					this.updateFixedValueButtons();
				});
			} else {
				value = Math.random() < 0.9 ? 2 : 4;
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
		// Save current state to history BEFORE calculating the move
		// This ensures we save the state before any modifications
		this.saveStateToHistory();

		const moveResult = this.calculateMove(direction);

		if (!moveResult.moved) {
			// If no valid move, remove the state we just saved
			this.history.pop();
			// Update button state since history changed
			this.updateUndoButton();
			return; // No valid move, don't animate or block
		}

		this.animating = true;
		// Don't update button state during animation to reduce UI flickering

		try {
			// Stage 1: Move all tiles to their target positions (including source tiles that will merge)
			this.renderTilesForMovement(moveResult.mergeInfo);

			// Wait for movement animation to complete
			await new Promise(resolve => setTimeout(resolve, 100));

			// Stage 2: Now mark source tiles for removal and perform merges
			moveResult.tilesToRemove.forEach(id => {
				const tile = this.tiles.get(id);
				if (tile) tile.toRemove = true;
			});

			this.performMerges(moveResult.mergeInfo);
			this.cleanupMergedTiles();
			this.renderTiles();

			// Wait for merge animation (pop effect)
			await new Promise(resolve => setTimeout(resolve, 50));

			// Stage 3: Add new random tile
			this.addRandomTile();
			this.renderTiles();

			this.updateScore();
			this.saveGameState();
			// Update button state after move completes (history has changed)
			this.updateUndoButton();
		} finally {
			this.animating = false;
			// Check game over after animation completes
			this.checkGameOver();
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
		// Calculate cell size
		const containerWidth = this.gridContainer.offsetWidth;
		// Get gap from computed style (supports responsive gap)
		const gapStyle = window.getComputedStyle(this.gridContainer).gap;
		const gap = gapStyle ? parseInt(gapStyle) || 15 : 15;
		const cellSize = (containerWidth - (this.gridSize - 1) * gap) / this.gridSize;

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
		// Calculate cell size
		const containerWidth = this.gridContainer.offsetWidth;
		// Get gap from computed style (supports responsive gap)
		const gapStyle = window.getComputedStyle(this.gridContainer).gap;
		const gap = gapStyle ? parseInt(gapStyle) || 15 : 15;
		const cellSize = (containerWidth - (this.gridSize - 1) * gap) / this.gridSize;

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

		// Update best score
		if (this.score > this.bestScore) {
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
	async saveGameState() {
		// Convert tiles Map to array for storage
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
			won: this.won
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
		// Clear history when loading saved state (don't restore history)
		this.history = [];

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

		this.renderTiles();
		this.updateScore();
		this.updateUndoButton();
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
