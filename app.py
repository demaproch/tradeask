"""Dashboard Dash : équité en temps réel, positions, trades, boutons timeframe.

Lancement : python app.py  -> http://127.0.0.1:8050
"""
from __future__ import annotations

import time
from datetime import datetime

import dash
import numpy as np
import plotly.graph_objects as go
from dash import dcc, html, callback, Input, Output, State

import config
from bot import engine
from strategy import compute_rsi


def make_app() -> dash.Dash:
    app = dash.Dash(__name__, suppress_callback_exceptions=True,
                    title="Bot Momentum RSI")

    tf_buttons = [
        html.Button(tf, id={"type": "tf-btn", "tf": tf},
                    className="tf-btn", n_clicks=0)
        for tf in config.TIMEFRAMES
    ]

    app.layout = html.Div([
        html.H1("🤖 Bot Momentum RSI — Paper Trading"),
        html.Div(id="status-bar", className="status"),

        html.Div([
            html.Span("Timeframe : "),
            html.Div(tf_buttons, id="tf-buttons", className="tf-buttons"),
            html.Span(id="current-tf", className="current-tf"),
        ], className="tf-row"),

        html.Div([
            html.Button("⏸ Pause", id="btn-pause", n_clicks=0),
            html.Button("▶ Démarrer", id="btn-start", n_clicks=0),
            html.Button("🔴 Fermer toutes les positions", id="btn-close-all",
                        n_clicks=0),
        ], className="controls"),

        dcc.Graph(id="equity-graph"),
        html.H2("Positions ouvertes"),
        html.Div(id="positions-table"),
        html.H2("Derniers trades"),
        html.Div(id="trades-table"),

        dcc.Interval(id="interval", interval=10 * 1000, n_intervals=0),
    ])

    @app.callback(
        Output("status-bar", "children"),
        Output("current-tf", "children"),
        Input("interval", "n_intervals"),
    )
    def status(_):
        eq = engine.capital + sum(
            _u_pnl(p) for p in engine.positions.values())
        wins = sum(1 for t in engine.trades if t.pnl > 0)
        n = len(engine.trades)
        wr = f"{wins / n * 100:.0f}%" if n else "—"
        state = "🟢 EN COURS" if engine.running else "🔴 EN PAUSE"
        return (
            f"{state} | Équité: {eq:,.2f}$ | Capital réalisé: "
            f"{engine.capital:,.2f}$ | Trades: {n} | Win rate: {wr} | "
            f"Paires: {', '.join(s.split('/')[0] for s in config.SYMBOLS)}",
            engine.timeframe,
        )

    @app.callback(
        Output("equity-graph", "figure"),
        Input("interval", "n_intervals"),
    )
    def equity_figure(_):
        hist = list(engine.equity_history)
        # point live
        eq_live = engine.capital + sum(_u_pnl(p) for p in engine.positions.values())
        hist.append((int(time.time()), round(eq_live, 2)))
        xs = [datetime.fromtimestamp(t) for t, _ in hist]
        ys = [v for _, v in hist]
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=xs, y=ys, mode="lines+markers",
                                 name="Équité ($)", line=dict(color="#00b894")))
        fig.add_hline(y=config.INITIAL_CAPITAL, line_dash="dot",
                      annotation_text="Capital initial")
        fig.update_layout(template="plotly_dark", height=420,
                          margin=dict(l=40, r=20, t=30, b=40),
                          yaxis_title="Équité (USD, PnL non réalisé inclus)")
        return fig

    @app.callback(
        Output("positions-table", "children"),
        Input("interval", "n_intervals"),
    )
    def positions_table(_):
        rows = []
        for p in engine.positions.values():
            upnl = _u_pnl(p)
            rows.append(html.Tr([
                html.Td(p.symbol), html.Td(p.side),
                html.Td(f"{p.entry_price:.4f}"), html.Td(f"{p.quantity:.6f}"),
                html.Td(f"{p.margin:.2f}$ x{p.leverage:.0f}"),
                html.Td(f"{p.tp_price:.4f}"), html.Td(f"{p.sl_price:.4f}"),
                html.Td(f"{upnl:+.2f}$",
                        style={"color": "green" if upnl >= 0 else "red"}),
            ]))
        header = html.Tr([html.Th(h) for h in
                          ["Symbole", "Côté", "Entrée", "Qté", "Marge",
                           "TP", "SL", "PnL flottant"]])
        return html.Table([header] + rows, className="tbl") if rows else \
            html.Div("Aucune position ouverte.")

    @app.callback(
        Output("trades-table", "children"),
        Input("interval", "n_intervals"),
    )
    def trades_table(_):
        recent = engine.trades[-15:][::-1]
        rows = []
        for t in recent:
            rows.append(html.Tr([
                html.Td(datetime.fromtimestamp(t.closed_at).strftime("%d/%m %H:%M")),
                html.Td(t.symbol), html.Td(t.side),
                html.Td(f"{t.entry_price:.4f}"), html.Td(f"{t.exit_price:.4f}"),
                html.Td(t.reason),
                html.Td(f"{t.pnl:+.2f}$",
                        style={"color": "green" if t.pnl >= 0 else "red"}),
            ]))
        header = html.Tr([html.Th(h) for h in
                          ["Clôture", "Symbole", "Côté", "Entrée", "Sortie",
                           "Raison", "PnL"]])
        return html.Table([header] + rows, className="tbl") if rows else \
            html.Div("Aucun trade clôturé.")

    # Boutons timeframe
    @app.callback(
        Output("tf-buttons", "className"),
        Input({"type": "tf-btn", "tf": dash.ALL}, "n_clicks"),
        State({"type": "tf-btn", "tf": dash.ALL}, "children"),
        prevent_initial_call=True,
    )
    def set_tf(clicks, labels):
        ctx_id = dash.callback_context.triggered_id
        if isinstance(ctx_id, dict) and ctx_id.get("tf"):
            engine.set_timeframe(ctx_id["tf"])
        return "tf-buttons"

    @app.callback(Output("btn-placeholder", "children"),
                  Input("btn-pause", "n_clicks"), prevent_initial_call=True)
    def _pause(_):
        engine.stop()
        return ""

    @app.callback(Output("btn-placeholder2", "children"),
                  Input("btn-start", "n_clicks"), prevent_initial_call=True)
    def _start(_):
        engine.start()
        return ""

    @app.callback(Output("btn-placeholder3", "children"),
                  Input("btn-close-all", "n_clicks"), prevent_initial_call=True)
    def _close_all(_):
        engine.close_all()
        return ""

    # Les placeholders n'existent pas dans la layout -> on déclare des Stores cachés
    app.layout.children.append(html.Div(style={"display": "none"}, children=[
        html.Div(id="btn-placeholder"),
        html.Div(id="btn-placeholder2"),
        html.Div(id="btn-placeholder3"),
    ]))

    return app


def _u_pnl(pos) -> float:
    """PnL flottant d'une position (best effort, prix via cache rapide)."""
    try:
        price = engine.last_price(pos.symbol)
        from strategy import unrealized_pnl
        return unrealized_pnl(pos.entry_price, pos.quantity, pos.side, price)
    except Exception:
        return 0.0


app = make_app()

if __name__ == "__main__":
    engine.start()
    app.run(host="127.0.0.1", port=8050, debug=False)
