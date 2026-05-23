from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import chess
import requests
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=os.path.join(BASE_DIR, 'static'))
CORS(app)
board = chess.Board()

def make_ai_move():
    if board.is_game_over():
        return None
    try:
        fen = board.fen()
        url = f"https://stockfish.online/api/s/v2.php?fen={fen}&depth=10"
        response = requests.get(url).json()
        if response.get('success'):
            bestmove = response['bestmove'].split(' ')[1]
            move = chess.Move.from_uci(bestmove)
            if move in board.legal_moves:
                board.push(move)
                return bestmove
    except Exception as e:
        print("AI Move Error:", e)
    return None

@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/state', methods=['GET'])
def get_state():
    return jsonify({
        'fen': board.fen(),
        'is_check': board.is_check(),
        'is_checkmate': board.is_checkmate(),
        'is_game_over': board.is_game_over(),
        'result': board.result() if board.is_game_over() else None
    })

@app.route('/move', methods=['POST'])
def make_move():
    move_uci = request.json.get('move')
    try:
        move = chess.Move.from_uci(move_uci)
        if move in board.legal_moves:
            board.push(move)
            player_fen = board.fen()
            ai_move_uci = None
            if not board.is_game_over():
                ai_move_uci = make_ai_move()
            return jsonify({
                'player_fen': player_fen,
                'fen': board.fen(),
                'status': 'success',
                'ai_move': ai_move_uci,
                'is_check': board.is_check(),
                'is_checkmate': board.is_checkmate(),
                'is_game_over': board.is_game_over(),
                'result': board.result() if board.is_game_over() else None
            })
        else:
            return jsonify({'status': 'error', 'message': 'Illegal move'}), 400
    except:
        return jsonify({'status': 'error', 'message': 'Invalid move format'}), 400

@app.route('/analyze', methods=['GET'])
def analyze_position():
    try:
        fen = board.fen()
        url = f"https://stockfish.online/api/s/v2.php?fen={fen}&depth=10"
        response = requests.get(url).json()
        if not response.get('success'):
            return jsonify({'status': 'error', 'message': 'Stockfish API failed'}), 500
        
        evaluation = response.get('evaluation')
        mate = response.get('mate')
        bestmove_str = response.get('bestmove')
        continuation = response.get('continuation', '')
        
        # Parse bestmove
        bestmove_uci = bestmove_str.split(' ')[1]
        move = chess.Move.from_uci(bestmove_uci)
        
        # Get piece and SAN
        piece = board.piece_at(move.from_square)
        piece_name = chess.piece_name(piece.piece_type).capitalize() if piece else "Piece"
        is_capture = board.is_capture(move)
        gives_check = board.gives_check(move)
        is_castling = board.is_castling(move)
        san = board.san(move)
        
        # Generate advice
        advice = ""
        if mate is not None:
            if mate > 0:
                advice = f"Mate in {mate}. You have them on the ropes. Play {san} and finish it. Don't choke."
            else:
                advice = f"Mate in {abs(mate)} against you. You walked right into a buzzsaw. The engine suggests {san} to delay the inevitable."
        else:
            # Base advice on evaluation
            if evaluation > 2.0:
                advice = f"You're up +{evaluation:.1f}. Position is highly favorable. Play {san} to keep squeezing."
            elif evaluation > 0.5:
                advice = f"Slight edge (+{evaluation:.1f}). Standard positional play. {san} is the cleanest way to maintain pressure."
            elif -0.5 <= evaluation <= 0.5:
                advice = f"Dead even ({evaluation:.1f}). It's a knife fight in a phone booth. Play {san} to hold the balance."
            elif evaluation < -2.0:
                advice = f"Down {evaluation:.1f}. You're bleeding out. Play {san} and look for tactical complications to muddy the waters."
            else:
                advice = f"Slight disadvantage ({evaluation:.1f}). They're starting to dictate the tempo. Play {san} to shore up your defense."
        
        # Add piece-specific tactical details
        if gives_check:
            advice += f" {piece_name} to {san} delivers a check, forcing their king to react."
        elif is_capture:
            advice += f" Taking on {san[-2:]} removes a key defender and wins material."
        elif is_castling:
            advice += " Castling tucks your king away safely and activates your rook."
        elif piece and piece.piece_type == chess.PAWN:
            advice += f" Pushing the pawn to {san} stakes a claim in the center and opens up lines."
        elif piece and piece.piece_type == chess.KNIGHT:
            advice += f" Repositioning the Knight to {san} targets key weak squares in their camp."
        elif piece and piece.piece_type == chess.BISHOP:
            advice += f" Placing the Bishop on the long diagonal at {san} exerts beautiful long-range pressure."
        elif piece and piece.piece_type == chess.ROOK:
            advice += f" Seizing the open file with the Rook on {san} is classic chess principles."
        elif piece and piece.piece_type == chess.QUEEN:
            advice += f" Activating the Queen to {san} coordinates your forces for a serious offensive."
            
        return jsonify({
            'status': 'success',
            'evaluation': evaluation,
            'mate': mate,
            'bestmove': bestmove_uci,
            'san': san,
            'continuation': continuation,
            'advice': advice
        })
    except Exception as e:
        print("Analyze Error:", e)
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/reset', methods=['POST'])
def reset_board():
    board.reset()
    return jsonify({'fen': board.fen()})

@app.route('/learning_profile', methods=['GET'])
def get_learning_profile():
    import json
    try:
        profile_path = os.path.join(BASE_DIR, 'learning_profile.json')
        if os.path.exists(profile_path):
            with open(profile_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return jsonify(data)
        else:
            return jsonify({'status': 'error', 'message': 'Profile not found'}), 404
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=False, port=8000)
