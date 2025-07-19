// === あみだくじゲーム script.js ===

// ==== DOM要素の取得 ====
const DOM = {
    gameContainer: document.getElementById('game-container'),
    characterSelection: document.getElementById('character-selection'),
    amidakujiArea: document.getElementById('amidakuji-area'),
    amidakujiCanvas: document.getElementById('amidakujiCanvas'),
    resultArea: document.getElementById('result-area'),
    resultImage: document.getElementById('result-image'),
    resultMessage: document.getElementById('result-message'),
    scoreChange: document.getElementById('score-change'),
    fireworks: document.getElementById('fireworks'),
    nextButton: document.getElementById('next-button'),
    resetButton: document.getElementById('reset-button'),
    gameOverArea: document.getElementById('game-over-area'),
    finalScore: document.getElementById('final-score'),
    finalMessage: document.getElementById('final-message'),
    restartButton: document.getElementById('restart-button'),
    characters: document.querySelectorAll('.character-icon'),
    bgm: document.getElementById('bgm'),
    // ゲーム情報表示
    currentLevel: document.getElementById('current-level'),
    currentScore: document.getElementById('current-score'),
    remainingTurns: document.getElementById('remaining-turns'),
};

const ctx = DOM.amidakujiCanvas.getContext('2d');

// ==== 音声 ====
const sounds = {
    click: new Audio('sounds/click.mp3'),
    success: new Audio('sounds/success.mp3'),
    explosion: new Audio('sounds/explosion.mp3'),
    move: new Audio('sounds/move.mp3')
};

// 音声の読み込み
Object.values(sounds).forEach(sound => {
    sound.load();
    sound.volume = 0.5;
});

// キャラごとの声ファイル
const CHARACTER_VOICE_PATHS = [
    'sounds/ninja.mp3',
    'sounds/busi.mp3',
    'sounds/miko.mp3'
];

// ==== ゲーム設定 ====
const GAME_CONFIG = {
    MAX_LEVELS: 10,
    MAX_TURNS: 10,
    BASE_ROWS: 8,
    BASE_COLUMNS: 3,
    MAX_COLUMNS: 3, // キャラクター数に合わせて最大3列に制限
    CELL_HEIGHT: 60,
    LINE_WIDTH: 4,
    START_Y_OFFSET: 20,
    GOAL_AREA_HEIGHT: 80,
    CHAR_SIZE: 50,
    MOVE_SPEED_Y: 2,
    MOVE_SPEED_X: 2,
    BOUNCE_HEIGHT: 10,
    BOUNCE_DURATION: 150,
    // スコア設定
    TREASURE_SCORE: 100,
    BOMB_PENALTY: -50,
    LEVEL_BONUS: 20, // レベルごとのボーナス
    // 難易度設定
    BASE_HORIZONTAL_CHANCE: 0.4, // 横線の基本確率
    HORIZONTAL_CHANCE_INCREASE: 0.05, // レベルごとの横線確率増加
    MAX_HORIZONTAL_CHANCE: 0.8, // 横線の最大確率
    ROWS_INCREASE: 2, // レベルごとの行数増加
};

// ==== ゲーム状態 ====
const gameState = {
    currentLevel: 1,
    currentScore: 0,
    remainingTurns: GAME_CONFIG.MAX_TURNS,
    selectedIndex: -1,
    isPlaying: false,
    currentX: -1,
    currentY: -1,
    currentCol: -1,
    animFrameId: null,
    paths: [],
    results: [],
    charStartXs: [],
    isBouncing: false,
    bounceTimer: 0,
    isMovingHorizontally: false,
    gameCompleted: false,
};

// ==== アセット管理 ====
const assets = {
    characterImages: [],
    goalImages: {},
};

// ==== 初期化処理 ====
function preloadAssets() {
    // キャラクター画像の読み込み
    DOM.characters.forEach((char, i) => {
        const img = new Image();
        img.src = char.src;
        assets.characterImages[i] = img;
    });
    
    // ゴール画像の読み込み
    ['treasure', 'bomb'].forEach(type => {
        const img = new Image();
        img.src = `images/${type}.png`;
        assets.goalImages[type] = img;
    });
}

function initializeGame() {
    gameState.currentLevel = 1;
    gameState.currentScore = 0;
    gameState.remainingTurns = GAME_CONFIG.MAX_TURNS;
    gameState.gameCompleted = false;
    
    updateGameInfo();
    resetUI();
    generateLevel();
}

function generateLevel() {
    // レベルに応じた設定を計算
    const levelConfig = calculateLevelConfig(gameState.currentLevel);
    
    // キャンバスサイズの設定
    DOM.amidakujiCanvas.width = DOM.amidakujiArea.clientWidth - 30;
    DOM.amidakujiCanvas.height = (levelConfig.numRows + 1) * GAME_CONFIG.CELL_HEIGHT + 
                                 GAME_CONFIG.START_Y_OFFSET + GAME_CONFIG.GOAL_AREA_HEIGHT;
    
    // キャラクター開始位置の計算（常に3列に固定）
    gameState.charStartXs = Array.from({ length: GAME_CONFIG.MAX_COLUMNS }, (_, i) =>
        (DOM.amidakujiCanvas.width / (GAME_CONFIG.MAX_COLUMNS + 1)) * (i + 1)
    );
    
    generatePaths(levelConfig);
    drawAll();
}

function calculateLevelConfig(level) {
    const numRows = GAME_CONFIG.BASE_ROWS + Math.floor((level - 1) * GAME_CONFIG.ROWS_INCREASE);
    // 列数は常に3に固定（キャラクター数に合わせる）
    const numColumns = GAME_CONFIG.MAX_COLUMNS;
    const horizontalChance = Math.min(
        GAME_CONFIG.BASE_HORIZONTAL_CHANCE + (level - 1) * GAME_CONFIG.HORIZONTAL_CHANCE_INCREASE,
        GAME_CONFIG.MAX_HORIZONTAL_CHANCE
    );
    
    return {
        numRows,
        numColumns,
        horizontalChance
    };
}

function resetUI() {
    DOM.characterSelection.style.display = 'block';
    DOM.resultArea.style.display = 'none';
    DOM.gameOverArea.style.display = 'none';
    DOM.fireworks.classList.remove('show');
    DOM.resultImage.style.display = 'none';
    DOM.resultMessage.textContent = '';
    DOM.resultMessage.className = '';
    DOM.scoreChange.textContent = '';
    DOM.scoreChange.className = '';
    
    // キャラクター選択をリセット
    DOM.characters.forEach(char => {
        char.classList.remove('selected');
    });
    
    // ゲーム状態をリセット
    gameState.selectedIndex = -1;
    gameState.currentX = -1;
    gameState.currentY = -1;
    gameState.currentCol = -1;
    gameState.isBouncing = false;
    gameState.bounceTimer = 0;
    gameState.isMovingHorizontally = false;
    
    if (gameState.animFrameId) {
        cancelAnimationFrame(gameState.animFrameId);
    }
    
    DOM.bgm.pause();
    DOM.bgm.currentTime = 0;
}

function updateGameInfo() {
    DOM.currentLevel.textContent = gameState.currentLevel;
    DOM.currentScore.textContent = gameState.currentScore;
    DOM.remainingTurns.textContent = gameState.remainingTurns;
}

// ==== あみだくじ生成 ====
function generatePaths(levelConfig) {
    // パスの初期化（常に3列に固定）
    gameState.paths = Array.from({ length: GAME_CONFIG.MAX_COLUMNS }, () => []);
    
    // 結果の設定（1つは宝箱、残りは爆弾）
    const results = Array(GAME_CONFIG.MAX_COLUMNS).fill('bomb');
    results[Math.floor(Math.random() * GAME_CONFIG.MAX_COLUMNS)] = 'treasure';
    gameState.results = results;
    
    // 横線の生成（レベルに応じて確率が上がる）
    for (let r = 0; r < levelConfig.numRows; r++) {
        for (let c = 0; c < GAME_CONFIG.MAX_COLUMNS - 1; c++) {
            if (Math.random() < levelConfig.horizontalChance) {
                const hasLeft = gameState.paths[c].some(p => p.row === r);
                const hasRight = gameState.paths[c + 1].some(p => p.row === r);
                
                if (!hasLeft && !hasRight) {
                    gameState.paths[c].push({ row: r, toCol: c + 1 });
                    gameState.paths[c + 1].push({ row: r, toCol: c });
                }
            }
        }
    }
}

// ==== 描画処理 ====
function drawAll() {
    const levelConfig = calculateLevelConfig(gameState.currentLevel);
    ctx.clearRect(0, 0, DOM.amidakujiCanvas.width, DOM.amidakujiCanvas.height);
    drawLines(levelConfig);
    drawGoals(levelConfig);
    drawCharacter();
}

function drawLines(levelConfig) {
    // 縦線の描画（常に3列に固定）
    ctx.lineWidth = GAME_CONFIG.LINE_WIDTH;
    ctx.strokeStyle = '#8D6E63';
    ctx.lineCap = 'round';
    
    for (let i = 0; i < GAME_CONFIG.MAX_COLUMNS; i++) {
        const x = gameState.charStartXs[i];
        ctx.beginPath();
        ctx.moveTo(x, GAME_CONFIG.START_Y_OFFSET);
        ctx.lineTo(x, DOM.amidakujiCanvas.height - GAME_CONFIG.GOAL_AREA_HEIGHT);
        ctx.stroke();
    }
    
    // 横線の描画
    ctx.strokeStyle = '#A1887F';
    ctx.lineWidth = GAME_CONFIG.LINE_WIDTH;
    
    gameState.paths.forEach((col, ci) => {
        col.forEach(p => {
            if (p.toCol > ci) {
                const y = GAME_CONFIG.START_Y_OFFSET + (p.row + 0.5) * GAME_CONFIG.CELL_HEIGHT;
                const x1 = gameState.charStartXs[ci];
                const x2 = gameState.charStartXs[p.toCol];
                
                ctx.beginPath();
                ctx.moveTo(x1, y);
                ctx.lineTo(x2, y);
                ctx.stroke();
            }
        });
    });
}

function drawGoals(levelConfig) {
    for (let i = 0; i < GAME_CONFIG.MAX_COLUMNS; i++) {
        const img = assets.goalImages[gameState.results[i]];
        if (!img || !img.complete) continue;
        
        const x = gameState.charStartXs[i];
        const y = DOM.amidakujiCanvas.height - GAME_CONFIG.GOAL_AREA_HEIGHT / 2;
        
        ctx.drawImage(img, x - 30, y - 30, 60, 60);
    }
}

function drawCharacter() {
    if (gameState.selectedIndex === -1 || gameState.currentY < 0) return;
    
    const img = assets.characterImages[gameState.selectedIndex];
    if (!img || !img.complete) return;
    
    let displayY = gameState.currentY;
    if (gameState.isBouncing) {
        const bounceOffset = Math.sin((gameState.bounceTimer / GAME_CONFIG.BOUNCE_DURATION) * Math.PI) * GAME_CONFIG.BOUNCE_HEIGHT;
        displayY -= bounceOffset;
    }

    ctx.drawImage(
        img,
        gameState.currentX - GAME_CONFIG.CHAR_SIZE / 2,
        displayY - GAME_CONFIG.CHAR_SIZE / 2,
        GAME_CONFIG.CHAR_SIZE,
        GAME_CONFIG.CHAR_SIZE
    );
}

// ==== ゲーム進行 ====
function selectCharacter(index) {
    if (gameState.isPlaying || gameState.selectedIndex !== -1 || gameState.remainingTurns <= 0) return;

    // キャラごとの声を再生
    const voice = new Audio(CHARACTER_VOICE_PATHS[index]);
    voice.volume = 0.7;
    voice.play().catch(e => {
        console.log('キャラ声再生に失敗', e);
    });

    // 音楽を開始
    DOM.bgm.play().catch(() => {
        console.log('BGM再生に失敗しました');
    });

    gameState.selectedIndex = index;
    gameState.currentCol = index;

    // キャラクター選択の表示
    DOM.characters[index].classList.add('selected');
    
    // 効果音
    sounds.click.play().catch(() => {});

    // ゲーム開始
    gameState.isPlaying = true;
    gameState.currentX = gameState.charStartXs[index];
    gameState.currentY = GAME_CONFIG.START_Y_OFFSET;

    animateMove();
}

function animateMove() {
    if (gameState.isMovingHorizontally) {
        gameState.animFrameId = requestAnimationFrame(animateMove);
        return;
    }

    const goalY = DOM.amidakujiCanvas.height - GAME_CONFIG.GOAL_AREA_HEIGHT;

    if (gameState.currentY >= goalY) {
        // ゴール到達時にMOVE効果音を停止
        sounds.move.pause();
        sounds.move.currentTime = 0;
        showResult();
        return;
    }

    const levelConfig = calculateLevelConfig(gameState.currentLevel);
    const nextCross = gameState.paths[gameState.currentCol].find(p => {
        const crossY = GAME_CONFIG.START_Y_OFFSET + (p.row + 0.5) * GAME_CONFIG.CELL_HEIGHT;
        return (gameState.currentY < crossY && gameState.currentY + GAME_CONFIG.MOVE_SPEED_Y >= crossY);
    });

    if (nextCross) {
        const crossY = GAME_CONFIG.START_Y_OFFSET + (nextCross.row + 0.5) * GAME_CONFIG.CELL_HEIGHT;
        gameState.currentY = crossY;
            
        sounds.move.play().catch(() => {});
        
        gameState.isBouncing = true;
        gameState.bounceTimer = 0;
        gameState.isMovingHorizontally = true;
        const targetX = gameState.charStartXs[nextCross.toCol];
        const startX = gameState.currentX;
        const startCol = gameState.currentCol;

        const animateHorizontalMove = () => {
            gameState.bounceTimer += 16;
            const progress = Math.min(1, gameState.bounceTimer / GAME_CONFIG.BOUNCE_DURATION);
            
            gameState.currentX = startX + (targetX - startX) * progress;
            
            drawAll();

            if (progress === 1) {
                gameState.isBouncing = false;
                gameState.currentX = targetX;
                gameState.currentCol = nextCross.toCol;
                gameState.isMovingHorizontally = false;
                animateMove();
            } else {
                gameState.animFrameId = requestAnimationFrame(animateHorizontalMove);
            }
        };
        animateHorizontalMove();
        return;
    }

    if (!gameState.isMovingHorizontally) {
        gameState.currentY += GAME_CONFIG.MOVE_SPEED_Y;
    }

    drawAll();

    // プレイヤーの動きに合わせて画面を自動スクロール
    const canvasRect = DOM.amidakujiCanvas.getBoundingClientRect();
    const charScreenY = canvasRect.top + gameState.currentY;
    const viewportCenter = window.innerHeight / 2;
    const margin = 150; // 余裕を持たせてスクロール

    // キャラクターが画面中央から離れすぎた場合にスクロール
    if (charScreenY > viewportCenter + margin || charScreenY < viewportCenter - margin) {
        const targetScrollY = window.scrollY + (charScreenY - viewportCenter);
        window.scrollTo({
            top: targetScrollY,
            behavior: 'smooth'
        });
    }

    gameState.animFrameId = requestAnimationFrame(animateMove);
}

function showResult() {
    if (gameState.animFrameId) {
        cancelAnimationFrame(gameState.animFrameId);
    }
    
    const result = gameState.results[gameState.currentCol];
    let scoreChange = 0;
    
    // スコア計算
    if (result === 'treasure') {
        scoreChange = GAME_CONFIG.TREASURE_SCORE + (gameState.currentLevel - 1) * GAME_CONFIG.LEVEL_BONUS;
        gameState.currentScore += scoreChange;
    } else {
        scoreChange = GAME_CONFIG.BOMB_PENALTY;
        gameState.currentScore += scoreChange;
    }
    
    // 残り回数を減らす
    gameState.remainingTurns--;
    
    // 結果表示
    DOM.resultArea.style.display = 'flex';
    DOM.resultImage.src = `images/${result}.png`;
    DOM.resultImage.style.display = 'block';
    
    if (result === 'treasure') {
        DOM.resultMessage.textContent = 'おめでとう！宝箱をゲット！';
        DOM.resultMessage.className = 'success';
        DOM.scoreChange.textContent = `+${scoreChange}ポイント！`;
        DOM.scoreChange.className = 'positive';
        
        DOM.fireworks.classList.add('show');
        sounds.success.play().catch(() => {});
        
        setTimeout(() => {
            DOM.fireworks.classList.remove('show');
        }, 3000);
        
    } else {
        DOM.resultMessage.textContent = '残念！爆弾に当たってしまった…';
        DOM.resultMessage.className = 'failure';
        DOM.scoreChange.textContent = `${scoreChange}ポイント`;
        DOM.scoreChange.className = 'negative';
        sounds.explosion.play().catch(() => {});
    }
    
    // ゲーム情報を更新
    updateGameInfo();
    
    // 次のレベルに進むか、ゲーム終了かを判定
    if (gameState.remainingTurns <= 0) {
        // ゲーム終了
        DOM.nextButton.style.display = 'none';
        DOM.resetButton.textContent = '結果を見る';
        gameState.gameCompleted = true;
    } else if (gameState.currentLevel < GAME_CONFIG.MAX_LEVELS) {
        // 次のレベルに進む
        DOM.nextButton.style.display = 'inline-block';
        DOM.resetButton.textContent = 'もう一度遊ぶ';
    } else {
        // 最終レベル完了
        DOM.nextButton.style.display = 'none';
        DOM.resetButton.textContent = '結果を見る';
        gameState.gameCompleted = true;
    }
    
    gameState.isPlaying = false;
}

function nextLevel() {
    if (gameState.currentLevel < GAME_CONFIG.MAX_LEVELS) {
        gameState.currentLevel++;
        resetUI();
        generateLevel();
        updateGameInfo();
    }
}

function showGameOver() {
    DOM.resultArea.style.display = 'none';
    DOM.characterSelection.style.display = 'none';
    DOM.amidakujiArea.style.display = 'none';
    DOM.gameOverArea.style.display = 'block';
    
    DOM.finalScore.textContent = `最終スコア: ${gameState.currentScore}ポイント`;
    
    // スコアに応じたメッセージ
    let message = '';
    if (gameState.currentScore >= 800) {
        message = '素晴らしい！完璧なプレイでした！';
    } else if (gameState.currentScore >= 600) {
        message = '優秀です！とても良い成績でした！';
    } else if (gameState.currentScore >= 400) {
        message = '良いプレイでした！もう少し頑張りましょう！';
    } else if (gameState.currentScore >= 200) {
        message = 'まずまずの成績です。次回はもっと頑張りましょう！';
    } else {
        message = '残念でした。次回はもっと慎重に選んでみましょう！';
    }
    
    DOM.finalMessage.textContent = message;
}

// ==== イベントリスナー ====
DOM.characters.forEach((char, i) => {
    char.addEventListener('click', () => selectCharacter(i));
});

DOM.nextButton.addEventListener('click', nextLevel);

DOM.resetButton.addEventListener('click', () => {
    if (gameState.gameCompleted) {
        showGameOver();
    } else {
        resetUI();
        generateLevel();
    }
});

DOM.restartButton.addEventListener('click', () => {
    DOM.gameOverArea.style.display = 'none';
    DOM.characterSelection.style.display = 'block';
    DOM.amidakujiArea.style.display = 'block';
    initializeGame();
});

// ==== 起動処理 ====
window.addEventListener('load', () => {
    preloadAssets();
    initializeGame();
});

window.addEventListener('resize', () => {
    if (!gameState.isPlaying) {
        generateLevel();
    }
});