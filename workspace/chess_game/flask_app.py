from flask import Flask, render_template, send_from_directory

app = Flask(__name__, static_folder='static')

@app.route('/')
def index():
    return render_template('C:/Users/Bl0ck/Substrate/workspace/chess_game/index.html')

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(app.static_folder, filename)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
