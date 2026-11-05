# Chess: a board in a room, and puzzles set by a character

A world can put a chess board in a room. Two visitors play on it while everyone else in the room watches, and where a character is named as the master of the board, that character sets puzzles from real games and keeps a puzzle rating for each visitor. The first boards are in Through the Looking-Glass: the Looking-Glass House (a board, no master), the Garden of Live Flowers (the Red Queen) and the Sheep's Shop (the White Queen).

## In the world file

```jsonc
"chess": [
  { "room": "looking-glass-house" },                                // a board; visitors play each other
  { "room": "garden-of-live-flowers", "master": "red-queen" }       // a board and a character who sets puzzles and kibitzes
]
```

`room` is a room id, `master` a character id. One entry per room. The provisioner adds `chessPrompt` (in `shared/src/chess.ts`) to a master's agent prompt so it knows what the record lines mean and what travels with a question.

## The game

Press C in a room with a board. The panel shows the two chairs, the board and the moves. Take a chair; when both chairs are taken, White begins. Click a piece, then a square (the legal squares are dotted; a pawn that reaches the last rank becomes a queen). The position lives in the world service, which checks every move with chess.js, so the board is the same for everyone in the room and a spectator who walks in sees the game where it stands. Resign, offer a draw (the other side accepts by offering too), and start a new game once this one is over. Checkmate, stalemate, insufficient material, threefold repetition and the fifty-move rule end the game by themselves.

A chair is yours again after a reload; when you leave the room the chair is free and the position stays, so someone else can sit down and finish the game, or you can come back to it. The board is cleared only by a player pressing New game.

The record goes into the room's chat as narration, a full move at a time (`Chess: 3. Qh5 Nf6`), with who sat down, draw offers, resignations and the whole game at the end (`Chess: Taras wins by checkmate, 1-0: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#`). "ask Red Queen" in the panel sends a question to the master in your name with the moves so far in brackets; any message that names the master during a game gets the same bracket, because the agent does not see the room's own narration (`docs/ETHORA-GAPS.md`, 22). The master is asked only when you talk to it; moves cost nothing.

## Puzzles

On the Puzzles tab the master sets a puzzle at your level, easier or harder. The puzzles are a sample of the Lichess puzzle database (CC0; `server/puzzles/lichess.csv`, 2400 puzzles rated 600 to 2500, popular ones with lines of one to four moves, with the game each comes from). The master speaks the puzzle (`A puzzle for you, Taras: White to move, rated 1450. Find the best line, 2 moves.`), the room makes the opponent's setup move, and you find the line move by move; the room plays the opponent's replies. A move that is not the line is a miss and you try again; any move that mates counts when the line ends in mate. Hint marks the piece to move. Show the solution gives up the puzzle.

Your puzzle rating starts at 1200 and moves like Elo against the puzzle's rating: a solve at the first try gains, a hinted solve gains half, a miss or giving up loses, and only the first verdict counts. The rating and the puzzles you have seen are kept per visitor across worlds in `DATA_DIR/chess/<visitor>.json` (no name in it). After each puzzle the record goes into the chat (`Puzzle: Taras solved a 1450 puzzle at the first try (a fork); puzzle rating 1216, 3 solved, 1 failed.`) and the master says a line. The motif is told only once the puzzle is over. When you stop or leave, a one-line note goes to the master's Memory through the hosted MCP (`- 2026-11-05: Taras did puzzles: 3 solved, 1 failed this visit; puzzle rating 1216 ... Missed a fork (1450)`), the same path as the Songbook's trainer; it needs `ETHORA_API_KEY` and is only logged without it.

## Where it lives

- `shared/src/chess.ts`: the world-file entry, the views the panel renders, the commands, the record text helpers, the master's prompt paragraph.
- `server/src/world/chess.ts`: `ChessGame` (chairs, moves, result), `PuzzleRun` (one puzzle with one player), the puzzle file, the rating, the progress file. Tests in `server/test/chess.test.ts`, which also plays every puzzle in the file through.
- `server/src/rooms/LocationRoom.ts`: the `chess` message, the chat lines, the chairs on join and leave, the Memory note.
- `client/src/ui/ChessPanel.tsx`: the panel and the board, loaded only in rooms with a board. Pieces are the Unicode chess glyphs coloured by CSS.

Not yet: playing against a character (an engine), a board on a table in the 3D room, time controls, takebacks.
