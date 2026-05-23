document.addEventListener('DOMContentLoaded', () => {
    const chessboard = document.getElementById('chessboard');
    const squares = [];
    let draggedPieceIndex = null;
    let selectedSquare = null;
    let currentFen = '';
    let moveHistory = [];
    let gameForfeited = false;

    const PIECES = {
        'p': '\u265f', 'r': '\u265c', 'n': '\u265e', 'b': '\u265d', 'q': '\u265b', 'k': '\u265a',
        'P': '\u2659', 'R': '\u2656', 'N': '\u2658', 'B': '\u2657', 'Q': '\u2655', 'K': '\u2654'
    };

    function squareToAlgebraic(index) {
        const file = String.fromCharCode('a'.charCodeAt(0) + (index % 8));
        const rank = 8 - Math.floor(index / 8);
        return file + rank;
    }


    function createBoard() {
        chessboard.innerHTML = '';
        squares.length = 0;
        for (let i = 0; i < 64; i++) {
            const square = document.createElement('div');
            square.classList.add('square');
            const row = Math.floor(i / 8);
            const col = i % 8;
            square.classList.add((row + col) % 2 === 0 ? 'light' : 'dark');
            square.dataset.index = i;
            square.addEventListener('dragover', e => e.preventDefault());
            square.addEventListener('drop', onDrop);
            square.addEventListener('click', onSquareClick);
            chessboard.appendChild(square);
            squares.push(square);
        }
    }

    async function renderPieces(force, customFen) {
        try {
            let fen;
            if (customFen) {
                fen = customFen;
            } else {
                const response = await fetch('/state');
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                fen = data.fen;
                handleGameState(data);
            }

            if (!force && fen === currentFen) return;
            currentFen = fen;

            const position = fen.split(' ')[0];

            // 1. Identify and match pieces
            const newBoardState = {}; // index -> pieceChar
            let fenIdx = 0;
            for (const char of position) {
                if (char === '/') continue;
                if (isNaN(parseInt(char))) {
                    newBoardState[fenIdx] = char;
                    fenIdx++;
                } else {
                    fenIdx += parseInt(char);
                }
            }

            const currentPieces = []; // array of { element, char, index, id }
            squares.forEach((square, index) => {
                const element = square.querySelector('.piece');
                if (element) {
                    const id = element.dataset.pieceId || '';
                    const char = id.split('-')[0] || element.textContent;
                    currentPieces.push({
                        element,
                        char,
                        index,
                        id
                    });
                }
            });

            const nextBoardElements = Array(64).fill(null);
            const matchedCurrentPieces = new Set();

            // Exact match (keep on same square)
            for (let i = 0; i < 64; i++) {
                const newChar = newBoardState[i];
                if (newChar) {
                    const current = currentPieces.find(p => p.index === i && p.char === newChar);
                    if (current) {
                        nextBoardElements[i] = current.element;
                        matchedCurrentPieces.add(current);
                    }
                }
            }

            // Match moved pieces
            for (let i = 0; i < 64; i++) {
                const newChar = newBoardState[i];
                if (newChar && !nextBoardElements[i]) {
                    const current = currentPieces.find(p => p.char === newChar && !matchedCurrentPieces.has(p));
                    if (current) {
                        nextBoardElements[i] = current.element;
                        matchedCurrentPieces.add(current);
                    }
                }
            }

            // 2. Record positions for FLIP
            const pieceRects = new Map();
            currentPieces.forEach(p => {
                if (matchedCurrentPieces.has(p)) {
                    pieceRects.set(p.element, p.element.getBoundingClientRect());
                }
            });

            // 3. Update the DOM
            for (let i = 0; i < 64; i++) {
                const square = squares[i];
                const targetElement = nextBoardElements[i];
                const currentElementInSquare = square.querySelector('.piece');

                if (targetElement) {
                    const pieceId = newBoardState[i] + '-' + squareToAlgebraic(i);
                    targetElement.dataset.pieceId = pieceId;

                    if (currentElementInSquare !== targetElement) {
                        square.appendChild(targetElement);
                    }
                } else {
                    if (currentElementInSquare) {
                        const isNeededElsewhere = Array.from(matchedCurrentPieces).some(p => p.element === currentElementInSquare);
                        if (!isNeededElsewhere) {
                            currentElementInSquare.remove();
                        }
                    }
                }

                // Create new piece if needed
                if (newBoardState[i] && !targetElement) {
                    const newChar = newBoardState[i];
                    const pieceElement = document.createElement('div');
                    pieceElement.classList.add('piece');
                    pieceElement.textContent = PIECES[newChar] || newChar;
                    const pieceId = newChar + '-' + squareToAlgebraic(i);
                    pieceElement.dataset.pieceId = pieceId;
                    if (newChar === newChar.toUpperCase() && newChar !== newChar.toLowerCase()) {
                        pieceElement.classList.add('draggable');
                        pieceElement.draggable = true;
                        pieceElement.addEventListener('dragstart', onDragStart);
                        pieceElement.addEventListener('dragend', onDragEnd);
                    }
                    square.appendChild(pieceElement);
                }
            }

            // Remove leftover unmatched pieces
            currentPieces.forEach(p => {
                if (!matchedCurrentPieces.has(p) && p.element.parentNode) {
                    p.element.remove();
                }
            });

            // 4. Animate (FLIP)
            pieceRects.forEach((oldRect, element) => {
                if (element.parentNode) {
                    const newRect = element.getBoundingClientRect();
                    const deltaX = oldRect.left - newRect.left;
                    const deltaY = oldRect.top - newRect.top;

                    if (deltaX !== 0 || deltaY !== 0) {
                        element.style.transition = 'none';
                        element.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
                        
                        element.offsetHeight; // force reflow

                        element.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
                        element.style.transform = 'translate(-50%, -50%)';
                    }
                }
            });

        } catch (error) {
            console.error('renderPieces error:', error);
        }
    }

    function onDragStart(event) {
        if (gameForfeited) {
            event.preventDefault();
            return;
        }
        const square = event.target.closest('.square');
        if (!square) return;
        draggedPieceIndex = parseInt(square.dataset.index);
        event.dataTransfer.setData('text/plain', draggedPieceIndex);
        event.target.style.opacity = '0.5';
    }

    function onDragEnd(event) {
        event.target.style.opacity = '1';
    }

    function onDrop(event) {
        if (gameForfeited) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        document.querySelectorAll('.piece').forEach(p => p.style.opacity = '1');
        const toSquare = event.target.closest('.square');
        if (!toSquare) return;
        const toIndex = parseInt(toSquare.dataset.index);
        if (draggedPieceIndex !== null && draggedPieceIndex !== toIndex) {
            const move = uciFromIndices(draggedPieceIndex, toIndex);
            makeMove(move);
        }
        draggedPieceIndex = null;
        clearSelectionUI();
    }

    function onSquareClick(event) {
        if (gameForfeited) return;
        const square = event.target.closest('.square');
        if (!square) return;
        const index = parseInt(square.dataset.index);
        const piece = square.querySelector('.piece');

        if (selectedSquare === null) {
            if (piece && piece.classList.contains('draggable')) {
                selectedSquare = index;
                square.classList.add('selected');
            }
        } else {
            if (selectedSquare !== index) {
                const move = uciFromIndices(selectedSquare, index);
                makeMove(move);
            }
            clearSelectionUI();
            selectedSquare = null;
        }
    }

    function clearSelectionUI() {
        squares.forEach(sq => sq.classList.remove('selected'));
    }

    function handleGameState(data) {
        const overlay = document.getElementById('game-status-overlay');
        const text = document.getElementById('game-status-text');
        if (!overlay || !text) return;
        if (data.is_checkmate) {
            text.textContent = 'Checkmate!';
            overlay.classList.remove('hidden');
        } else if (data.is_game_over) {
            text.textContent = 'Game Over';
            overlay.classList.remove('hidden');
        } else if (data.is_check) {
            text.textContent = 'Check!';
            overlay.classList.remove('hidden');
            setTimeout(() => overlay.classList.add('hidden'), 2000);
        } else {
            overlay.classList.add('hidden');
        }
    }

    async function makeMove(move) {
        try {
            const response = await fetch('/move', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({move: move})
            });
            const data = await response.json();
            if (data.status === 'success') {
                addMoveToHistory(move, 'You');
                
                // Render player's move first
                await renderPieces(true, data.player_fen);

                if (data.ai_move) {
                    // Wait for player's move animation to finish
                    await new Promise(resolve => setTimeout(resolve, 450));

                    // Highlight the AI's destination square
                    await animateAIMove(data.ai_move);

                    // Render AI's move
                    addMoveToHistory(data.ai_move, 'AI');
                    await renderPieces(true, data.fen);
                }
            } else {
                console.warn('Move rejected:', data.message);
                await renderPieces(true);
            }
        } catch (error) {
            console.error('makeMove error:', error);
        }
    }

    function animateAIMove(uci) {
        return new Promise(resolve => {
            if (!uci || uci.length < 4) return resolve();
            const fromFile = uci.charCodeAt(0) - 'a'.charCodeAt(0);
            const fromRank = 8 - parseInt(uci[1]);
            const toFile = uci.charCodeAt(2) - 'a'.charCodeAt(0);
            const toRank = 8 - parseInt(uci[3]);
            const fromIndex = fromRank * 8 + fromFile;
            const toIndex = toRank * 8 + toFile;

            const fromSquare = squares[fromIndex];
            const toSquare = squares[toIndex];
            if (!fromSquare || !toSquare) return resolve();

            // Highlight AI move
            toSquare.classList.add('ai-moved');
            setTimeout(() => toSquare.classList.remove('ai-moved'), 2000);
            resolve();
        });
    }

    function uciFromIndices(from, to) {
        const fromFile = String.fromCharCode('a'.charCodeAt(0) + (from % 8));
        const fromRank = 8 - Math.floor(from / 8);
        const toFile = String.fromCharCode('a'.charCodeAt(0) + (to % 8));
        const toRank = 8 - Math.floor(to / 8);

        let promotion = '';
        const piece = squares[from].querySelector('.piece');
        if (piece) {
            const pieceChar = piece.textContent;
            if (pieceChar === '\u2659' && toRank === 8) promotion = 'q';
        }
        return fromFile + fromRank + toFile + toRank + promotion;
    }

    function addMoveToHistory(move, player) {
        moveHistory.push({move, player});
        updateHistoryUI();
    }

    function updateHistoryUI() {
        const list = document.getElementById('move-list');
        if (!list) return;
        list.innerHTML = '';
        moveHistory.forEach((entry, i) => {
            const li = document.createElement('li');
            li.textContent = (i + 1) + '. ' + entry.player + ': ' + entry.move;
            list.appendChild(li);
        });
    }

    // Settings & Controls
    const root = document.documentElement;
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettings = document.getElementById('close-settings');
    const historyBtn = document.getElementById('history-btn');
    const historyModal = document.getElementById('history-modal');
    const closeHistory = document.getElementById('close-history');
    const resetBtn = document.getElementById('reset-btn');

    const trainingBtn = document.getElementById('training-btn');
    const trainingModal = document.getElementById('training-modal');
    const closeTraining = document.getElementById('close-training');
    const forfeitBtn = document.getElementById('forfeit-btn');

    const inGameAnalysisBtn = document.getElementById('in-game-analysis-btn');
    const inGameAnalysisPanel = document.getElementById('in-game-analysis-panel');

    if (settingsBtn) settingsBtn.addEventListener('click', () => settingsModal.classList.toggle('hidden'));
    if (closeSettings) closeSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
    if (historyBtn) historyBtn.addEventListener('click', () => historyModal.classList.toggle('hidden'));
    if (closeHistory) closeHistory.addEventListener('click', () => historyModal.classList.add('hidden'));

    let currentSlideIndex = 0;
    let presentationSlides = [];

    function renderMiniBoard(container, fen, highlights) {
        const position = fen.split(' ')[0];
        const boardState = {};
        let fenIdx = 0;
        for (const char of position) {
            if (char === '/') continue;
            if (isNaN(parseInt(char))) {
                boardState[fenIdx] = char;
                fenIdx++;
            } else {
                fenIdx += parseInt(char);
            }
        }

        // If container is empty, initialize the 64 squares
        if (container.children.length === 0) {
            for (let i = 0; i < 64; i++) {
                const square = document.createElement('div');
                square.className = 'mini-square';
                const row = Math.floor(i / 8);
                const col = i % 8;
                square.classList.add((row + col) % 2 === 0 ? 'light' : 'dark');
                square.dataset.index = i;
                container.appendChild(square);
            }
        }

        const squares = container.querySelectorAll('.mini-square');

        // 1. Record positions of existing pieces for FLIP
        const pieceRects = new Map();
        const currentPieces = [];
        squares.forEach((square, idx) => {
            const piece = square.querySelector('.mini-piece');
            if (piece) {
                currentPieces.push({ element: piece, char: piece.dataset.char, index: idx });
                pieceRects.set(piece, piece.getBoundingClientRect());
            }
        });

        // 2. Determine which pieces to keep, move, create, or delete
        const nextBoardElements = {};
        const matchedCurrentPieces = new Set();

        // Match exact pieces first (same type, same square)
        for (let i = 0; i < 64; i++) {
            const newChar = boardState[i];
            if (newChar) {
                const exactMatch = currentPieces.find(p => p.char === newChar && p.index === i);
                if (exactMatch) {
                    nextBoardElements[i] = exactMatch.element;
                    matchedCurrentPieces.add(exactMatch);
                }
            }
        }

        // Match moved pieces
        for (let i = 0; i < 64; i++) {
            const newChar = boardState[i];
            if (newChar && !nextBoardElements[i]) {
                const current = currentPieces.find(p => p.char === newChar && !matchedCurrentPieces.has(p));
                if (current) {
                    nextBoardElements[i] = current.element;
                    matchedCurrentPieces.add(current);
                }
            }
        }

        // 3. Update the DOM
        for (let i = 0; i < 64; i++) {
            const square = squares[i];
            const targetElement = nextBoardElements[i];
            const currentElementInSquare = square.querySelector('.mini-piece');

            // Update square highlights
            square.className = 'mini-square';
            const row = Math.floor(i / 8);
            const col = i % 8;
            square.classList.add((row + col) % 2 === 0 ? 'light' : 'dark');
            if (highlights) {
                const algebraic = squareToAlgebraic(i);
                const hl = highlights.find(h => h.square === algebraic);
                if (hl) {
                    square.classList.add(`highlight-${hl.type}`);
                }
            }

            if (targetElement) {
                if (currentElementInSquare !== targetElement) {
                    square.appendChild(targetElement);
                }
            } else {
                if (currentElementInSquare) {
                    const isNeededElsewhere = Array.from(matchedCurrentPieces).some(p => p.element === currentElementInSquare);
                    if (!isNeededElsewhere) {
                        currentElementInSquare.remove();
                    }
                }
            }

            // Create new piece if needed
            if (boardState[i] && !targetElement) {
                const newChar = boardState[i];
                const piece = document.createElement('div');
                piece.className = 'mini-piece';
                piece.dataset.char = newChar;
                piece.textContent = PIECES[newChar] || newChar;
                if (newChar === newChar.toUpperCase() && newChar !== newChar.toLowerCase()) {
                    piece.classList.add('white-piece');
                } else {
                    piece.classList.add('black-piece');
                }
                square.appendChild(piece);
            }
        }

        // Remove leftover unmatched pieces
        currentPieces.forEach(p => {
            if (!matchedCurrentPieces.has(p) && p.element.parentNode) {
                p.element.remove();
            }
        });

        // 4. Animate (FLIP)
        pieceRects.forEach((oldRect, element) => {
            if (element.parentNode) {
                const newRect = element.getBoundingClientRect();
                const deltaX = oldRect.left - newRect.left;
                const deltaY = oldRect.top - newRect.top;

                if (deltaX !== 0 || deltaY !== 0) {
                    element.style.transition = 'none';
                    element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

                    // Force reflow
                    element.offsetHeight;

                    element.style.transition = 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)';
                    element.style.transform = 'translate(0, 0)';
                }
            }
        });
    }

    function renderSlide(index) {
        const container = document.getElementById('active-presentation');
        if (!container || !presentationSlides.length) return;

        // Clear any previous active timers to avoid memory leaks/overlapping intervals
        if (container.activeTimer) {
            clearInterval(container.activeTimer);
            container.activeTimer = null;
        }

        const slide = presentationSlides[index];
        
        if (slide.fen) {
            const hasAnimation = slide.fens && slide.fens.length > 0;
            container.innerHTML = `
                <div class="presentation-split">
                    <div class="presentation-info">
                        <div class="slide-content">
                            <div class="slide-title">${slide.title}</div>
                            <div class="slide-text">${slide.content}</div>
                        </div>
                        
                        ${hasAnimation ? `
                        <div class="animation-controls-row">
                            <button class="anim-btn" id="anim-reset" title="Reset Animation"><i class="fas fa-backward-step"></i></button>
                            <button class="anim-btn" id="anim-prev" title="Previous Move"><i class="fas fa-chevron-left"></i></button>
                            <button class="anim-btn" id="anim-play-pause" title="Play/Pause"><i class="fas fa-play"></i></button>
                            <button class="anim-btn" id="anim-next" title="Next Move"><i class="fas fa-chevron-right"></i></button>
                            <button class="anim-btn" id="anim-end" title="Jump to End"><i class="fas fa-forward-step"></i></button>
                            <div class="anim-indicator" id="anim-indicator">Move 0 / ${slide.fens.length - 1}</div>
                        </div>
                        ` : ''}

                        <div class="presentation-controls">
                            <button class="slide-btn" id="prev-slide-btn" ${index === 0 ? 'disabled' : ''}>Prev Slide</button>
                            <div class="slide-indicator">Slide ${index + 1} / ${presentationSlides.length}</div>
                            <button class="slide-btn" id="next-slide-btn" ${index === presentationSlides.length - 1 ? 'disabled' : ''}>Next Slide</button>
                        </div>
                    </div>
                    <div class="presentation-board-container">
                        <div class="mini-chessboard" id="mini-chessboard"></div>
                    </div>
                </div>
            `;

            const miniBoardContainer = document.getElementById('mini-chessboard');
            
            if (hasAnimation) {
                let playbackIdx = 0;
                let isPlaying = false;
                let timer = null;

                const playPauseBtn = document.getElementById('anim-play-pause');
                const prevBtnAnim = document.getElementById('anim-prev');
                const nextBtnAnim = document.getElementById('anim-next');
                const resetBtnAnim = document.getElementById('anim-reset');
                const endBtnAnim = document.getElementById('anim-end');
                const indicatorEl = document.getElementById('anim-indicator');

                function updateBoard() {
                    const currentFen = slide.fens[playbackIdx];
                    const isLast = playbackIdx === slide.fens.length - 1;
                    renderMiniBoard(miniBoardContainer, currentFen, isLast ? slide.highlights : null);
                    
                    if (indicatorEl) {
                        indicatorEl.textContent = `Move ${playbackIdx} / ${slide.fens.length - 1}`;
                    }
                    if (playPauseBtn) {
                        playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
                    }
                }

                function stopPlayback() {
                    if (timer) {
                        clearInterval(timer);
                        timer = null;
                    }
                    isPlaying = false;
                    if (playPauseBtn) {
                        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
                    }
                }

                function startPlayback() {
                    if (playbackIdx === slide.fens.length - 1) {
                        playbackIdx = 0;
                    }
                    isPlaying = true;
                    if (playPauseBtn) {
                        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    }
                    timer = setInterval(() => {
                        if (playbackIdx < slide.fens.length - 1) {
                            playbackIdx++;
                            updateBoard();
                        } else {
                            stopPlayback();
                        }
                    }, 1200);
                    container.activeTimer = timer;
                }

                if (playPauseBtn) {
                    playPauseBtn.addEventListener('click', () => {
                        if (isPlaying) {
                            stopPlayback();
                        } else {
                            startPlayback();
                        }
                    });
                }

                if (prevBtnAnim) {
                    prevBtnAnim.addEventListener('click', () => {
                        stopPlayback();
                        if (playbackIdx > 0) {
                            playbackIdx--;
                            updateBoard();
                        }
                    });
                }

                if (nextBtnAnim) {
                    nextBtnAnim.addEventListener('click', () => {
                        stopPlayback();
                        if (playbackIdx < slide.fens.length - 1) {
                            playbackIdx++;
                            updateBoard();
                        }
                    });
                }

                if (resetBtnAnim) {
                    resetBtnAnim.addEventListener('click', () => {
                        stopPlayback();
                        playbackIdx = 0;
                        updateBoard();
                    });
                }

                if (endBtnAnim) {
                    endBtnAnim.addEventListener('click', () => {
                        stopPlayback();
                        playbackIdx = slide.fens.length - 1;
                        updateBoard();
                    });
                }

                // Initial render
                updateBoard();

                // Auto-start playback on slide load
                setTimeout(() => {
                    startPlayback();
                }, 500);

            } else {
                if (miniBoardContainer) {
                    renderMiniBoard(miniBoardContainer, slide.fen, slide.highlights);
                }
            }
        } else {
            container.innerHTML = `
                <div class="slide-content">
                    <div class="slide-title">${slide.title}</div>
                    <div class="slide-text">${slide.content}</div>
                </div>
                <div class="presentation-controls">
                    <button class="slide-btn" id="prev-slide-btn" ${index === 0 ? 'disabled' : ''}>Prev Slide</button>
                    <div class="slide-indicator">Slide ${index + 1} / ${presentationSlides.length}</div>
                    <button class="slide-btn" id="next-slide-btn" ${index === presentationSlides.length - 1 ? 'disabled' : ''}>Next Slide</button>
                </div>
            `;
        }

        const prevBtn = document.getElementById('prev-slide-btn');
        const nextBtn = document.getElementById('next-slide-btn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (currentSlideIndex > 0) {
                    currentSlideIndex--;
                    renderSlide(currentSlideIndex);
                }
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (currentSlideIndex < presentationSlides.length - 1) {
                    currentSlideIndex++;
                    renderSlide(currentSlideIndex);
                }
            });
        }
    }

    function loadLesson(data, title) {
        if (data.lessons && data.lessons[title]) {
            const lesson = data.lessons[title];
            presentationSlides = lesson.slides;
            currentSlideIndex = 0;
            
            const presentationHeader = document.querySelector('#active-presentation').parentNode.querySelector('h3');
            if (presentationHeader) {
                presentationHeader.innerHTML = `<i class="fas fa-desktop"></i> Active Chess Presentation: ${lesson.title || title}`;
            }
            
            renderSlide(currentSlideIndex);
            
            const presentationContainer = document.getElementById('active-presentation');
            if (presentationContainer) {
                presentationContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    async function loadLearningProfile() {
        try {
            const response = await fetch('/learning_profile');
            if (!response.ok) throw new Error('Failed to load profile');
            const data = await response.json();

            // 1. Accuracy & Blunder Rate Metrics
            const accuracyBar = document.getElementById('metric-accuracy');
            const blunderBar = document.getElementById('metric-blunders');
            if (accuracyBar) {
                accuracyBar.style.width = `${data.accuracy}%`;
                accuracyBar.textContent = `${data.accuracy}%`;
                accuracyBar.style.textAlign = 'right';
                accuracyBar.style.paddingRight = '5px';
                accuracyBar.style.fontSize = '0.7rem';
                accuracyBar.style.color = '#fff';
            }
            if (blunderBar) {
                blunderBar.style.width = `${data.blunder_rate}%`;
                blunderBar.textContent = `${data.blunder_rate}%`;
                blunderBar.style.textAlign = 'right';
                blunderBar.style.paddingRight = '5px';
                blunderBar.style.fontSize = '0.7rem';
                blunderBar.style.color = '#fff';
            }

            // 2. Cognitive Blindspots
            const blindspotsContainer = document.getElementById('cognitive-blindspots');
            if (blindspotsContainer) {
                blindspotsContainer.innerHTML = '';
                data.blindspots.forEach(b => {
                    const div = document.createElement('div');
                    div.className = `blindspot-item severity-${b.severity.toLowerCase()} clickable-lesson`;
                    div.style.cursor = 'pointer';
                    div.innerHTML = `
                        <div class="blindspot-title">${b.title} <span class="module-status" style="float:right; font-size:0.6rem; background:rgba(255,255,255,0.05);">${b.severity}</span></div>
                        <div class="blindspot-desc">${b.description}</div>
                    `;
                    div.addEventListener('click', () => {
                        loadLesson(data, b.title);
                    });
                    blindspotsContainer.appendChild(div);
                });
            }

            // 3. Tailored Modules
            const modulesContainer = document.getElementById('tailored-modules');
            if (modulesContainer) {
                modulesContainer.innerHTML = '';
                data.modules.forEach(m => {
                    const div = document.createElement('div');
                    div.className = 'module-item clickable-lesson';
                    div.style.cursor = 'pointer';
                    const statusClass = m.status.toLowerCase().replace(' ', '-');
                    div.innerHTML = `
                        <div class="module-icon"><i class="${m.icon}"></i></div>
                        <div class="module-content">
                            <div class="module-title-row">
                                <span class="module-title">${m.title}</span>
                                <span class="module-status ${statusClass}">${m.status}</span>
                            </div>
                            <div class="module-desc">${m.description}</div>
                        </div>
                    `;
                    div.addEventListener('click', () => {
                        loadLesson(data, m.title);
                    });
                    modulesContainer.appendChild(div);
                });
            }

            // 4. Presentation Slide Deck
            if (data.presentation && data.presentation.slides) {
                presentationSlides = data.presentation.slides;
                currentSlideIndex = 0;
                renderSlide(currentSlideIndex);
            }

        } catch (error) {
            console.error('Error loading learning profile:', error);
        }
    }

    if (trainingBtn) {
        trainingBtn.addEventListener('click', () => {
            const isHidden = trainingModal.classList.toggle('hidden');
            if (!isHidden) {
                loadLearningProfile();
            }
        });
    }
    if (closeTraining) {
        closeTraining.addEventListener('click', () => {
            trainingModal.classList.add('hidden');
            const container = document.getElementById('active-presentation');
            if (container && container.activeTimer) {
                clearInterval(container.activeTimer);
                container.activeTimer = null;
            }
        });
    }

    if (forfeitBtn) {
        forfeitBtn.addEventListener('click', () => {
            if (gameForfeited) return;
            gameForfeited = true;
            const overlay = document.getElementById('game-status-overlay');
            const text = document.getElementById('game-status-text');
            if (overlay && text) {
                text.textContent = 'You Forfeited';
                overlay.classList.remove('hidden');
            }
        });
    }

    if (inGameAnalysisBtn && inGameAnalysisPanel) {
        inGameAnalysisBtn.addEventListener('click', async () => {
            const isHidden = inGameAnalysisPanel.classList.toggle('hidden');
            if (isHidden) return;

            const scoreEl = document.getElementById('evaluation-score');
            const barEl = document.getElementById('evaluation-bar');
            const hintEl = document.getElementById('best-move-hint');
            const adviceEl = document.getElementById('coach-advice');

            if (scoreEl) scoreEl.textContent = 'Analyzing...';
            if (hintEl) hintEl.textContent = '...';
            if (adviceEl) adviceEl.textContent = 'Consulting Stockfish and the Substrate layers...';

            try {
                const response = await fetch('/analyze');
                if (!response.ok) throw new Error('Analysis failed');
                const data = await response.json();

                if (data.status === 'success') {
                    let scoreText = '';
                    let barWidth = 50;

                    if (data.mate !== null) {
                        scoreText = `Mate in ${data.mate}`;
                        barWidth = data.mate > 0 ? 95 : 5;
                    } else if (data.evaluation !== undefined) {
                        const evalVal = data.evaluation;
                        scoreText = evalVal > 0 ? `+${evalVal.toFixed(1)}` : `${evalVal.toFixed(1)}`;
                        let mapped = 50 + (evalVal * 10);
                        barWidth = Math.max(10, Math.min(90, mapped));
                    }

                    if (scoreEl) scoreEl.textContent = scoreText;
                    if (barEl) barEl.style.width = `${barWidth}%`;
                    if (hintEl) hintEl.textContent = data.san || data.bestmove;
                    if (adviceEl) adviceEl.textContent = data.advice;
                } else {
                    if (adviceEl) adviceEl.textContent = 'Failed to retrieve advice. The engine is silent.';
                }
            } catch (error) {
                console.error('Analysis error:', error);
                if (adviceEl) adviceEl.textContent = 'Error contacting analysis server.';
            }
        });
    }

    if (resetBtn) resetBtn.addEventListener('click', async () => {
        await fetch('/reset', {method: 'POST'});
        moveHistory = [];
        gameForfeited = false;
        updateHistoryUI();
        const overlay = document.getElementById('game-status-overlay');
        if (overlay) overlay.classList.add('hidden');
        
        // Reset coach UI
        const scoreEl = document.getElementById('evaluation-score');
        const barEl = document.getElementById('evaluation-bar');
        const hintEl = document.getElementById('best-move-hint');
        const adviceEl = document.getElementById('coach-advice');
        if (scoreEl) scoreEl.textContent = '0.0';
        if (barEl) barEl.style.width = '50%';
        if (hintEl) hintEl.textContent = "-";
        if (adviceEl) adviceEl.textContent = "I'm ready when you are.";

        if (inGameAnalysisPanel) inGameAnalysisPanel.classList.add('hidden');

        await renderPieces(true);
    });

    const opacitySlider = document.getElementById('opacity-slider');
    const blurSlider = document.getElementById('blur-slider');
    const themeSelect = document.getElementById('theme-select');

    if (opacitySlider) opacitySlider.addEventListener('input', e => {
        root.style.setProperty('--board-bg', 'rgba(15, 23, 42, ' + (e.target.value / 100) + ')');
        localStorage.setItem('boardOpacity', e.target.value);
    });
    if (blurSlider) blurSlider.addEventListener('input', e => {
        root.style.setProperty('--board-blur', e.target.value + 'px');
        localStorage.setItem('boardBlur', e.target.value);
    });
    if (themeSelect) themeSelect.addEventListener('change', e => {
        if (e.target.value === 'substrate') {
            document.body.removeAttribute('data-theme');
        } else {
            document.body.setAttribute('data-theme', e.target.value);
        }
        localStorage.setItem('boardTheme', e.target.value);
    });

    // Restore saved settings from localStorage
    const savedOpacity = localStorage.getItem('boardOpacity');
    if (savedOpacity !== null) {
        if (opacitySlider) opacitySlider.value = savedOpacity;
        root.style.setProperty('--board-bg', 'rgba(15, 23, 42, ' + (savedOpacity / 100) + ')');
    }
    const savedBlur = localStorage.getItem('boardBlur');
    if (savedBlur !== null) {
        if (blurSlider) blurSlider.value = savedBlur;
        root.style.setProperty('--board-blur', savedBlur + 'px');
    }
    const savedTheme = localStorage.getItem('boardTheme');
    if (savedTheme !== null) {
        if (themeSelect) themeSelect.value = savedTheme;
        if (savedTheme === 'substrate') {
            document.body.removeAttribute('data-theme');
        } else {
            document.body.setAttribute('data-theme', savedTheme);
        }
    }

    // Background drop
    const bgDropzone = document.getElementById('bg-dropzone');
    const removeBgBtn = document.getElementById('remove-bg-btn');
    const bgLayer = document.getElementById('background-layer');

    if (bgDropzone) {
        bgDropzone.addEventListener('dragover', e => { e.preventDefault(); bgDropzone.classList.add('dragover'); });
        bgDropzone.addEventListener('dragleave', () => bgDropzone.classList.remove('dragover'));
        bgDropzone.addEventListener('drop', e => {
            e.preventDefault();
            bgDropzone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = ev => {
                    bgLayer.style.backgroundImage = 'url(' + ev.target.result + ')';
                    localStorage.setItem('bgImage', ev.target.result);
                };
                reader.readAsDataURL(file);
            }
        });
    }
    if (removeBgBtn) removeBgBtn.addEventListener('click', () => {
        bgLayer.style.backgroundImage = 'none';
        localStorage.removeItem('bgImage');
    });

    // Restore saved background
    const savedBg = localStorage.getItem('bgImage');
    if (savedBg && bgLayer) bgLayer.style.backgroundImage = 'url(' + savedBg + ')';

    // Init
    createBoard();
    renderPieces(true);

    // Poll for state changes
    setInterval(() => renderPieces(), 3000);
});