
from flask import Flask, jsonify, request
import chess

app = Flask(__name__)
board = chess.Board()

@app.route('/board', methods=['GET'])
def get_board():
    return jsonify({
        'fen': board.fen(),
        'legal_moves': [move.uci() for move in board.legal_moves]
    })

@app.route('/move', methods=['POST'])
def make_move():
    move_uci = request.json.get('move')
    try:
        move = chess.Move.from_uci(move_uci)
        if move in board.legal_moves:
            board.push(move)
            return jsonify({'success': True, 'fen': board.fen()})
        else:
            return jsonify({'success': False, 'error': 'Illegal move'}), 400
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid move format'}), 400

if __name__ == '__main__':
    app.run(debug=True, port=5001)
