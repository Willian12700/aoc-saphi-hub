const https = require('https');

class GoalService {
  constructor() {
    this.activeAlert = null;
    this.knownMatches = new Map();
    this.pollInterval = null;
    this.init();
  }

  init() {
    this.checkScores();
    this.pollInterval = setInterval(() => this.checkScores(), 35000);
  }

  fetchJson(url) {
    return new Promise((resolve) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  }

  async checkScores() {
    try {
      const urls = [
        'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard',
        'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard',
        'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard'
      ];

      for (const url of urls) {
        const data = await this.fetchJson(url);
        if (!data || !Array.isArray(data.events)) continue;

        for (const ev of data.events) {
          const comp = ev.competitions?.[0];
          if (!comp) continue;

          const matchId = ev.id;
          const home = comp.competitors?.find(c => c.homeAway === 'home');
          const away = comp.competitors?.find(c => c.homeAway === 'away');
          if (!home || !away) continue;

          const homeScore = parseInt(home.score || '0', 10);
          const awayScore = parseInt(away.score || '0', 10);
          const homeName = home.team?.shortDisplayName || home.team?.displayName || 'Casa';
          const awayName = away.team?.shortDisplayName || away.team?.displayName || 'Fora';
          const statusState = comp.status?.type?.state; // 'in' = in progress

          if (this.knownMatches.has(matchId)) {
            const prev = this.knownMatches.get(matchId);
            if (statusState === 'in') {
              if (homeScore > prev.homeScore) {
                this.triggerGoal(homeName, `${homeScore} x ${awayScore}`, awayName, `${homeName} x ${awayName}`);
              } else if (awayScore > prev.awayScore) {
                this.triggerGoal(awayName, `${homeScore} x ${awayScore}`, homeName, `${homeName} x ${awayName}`);
              }
            }
          }

          this.knownMatches.set(matchId, {
            homeScore,
            awayScore,
            homeName,
            awayName,
            state: statusState
          });
        }
      }
    } catch (e) {
      console.log('[GOAL-SERVICE] Error checking scores:', e.message);
    }
  }

  triggerGoal(scoringTeam, scoreStr, opponent, matchTitle) {
    const text = `⚽ GOL DO ${scoringTeam.toUpperCase()}! (${scoreStr} ${opponent})`;
    console.log('[GOAL-SERVICE] Alert triggered:', text);
    this.activeAlert = {
      id: Date.now(),
      text,
      matchTitle: matchTitle || `${scoringTeam} x ${opponent}`,
      sub: '⚡ Pressione [OK] no controle para assistir ao vivo • [Voltar] Fechar',
      channelLogin: '',
      channelName: matchTitle || 'Futebol Ao Vivo',
      expiresAt: Date.now() + 25000 // valid for 25s
    };
  }

  triggerManualTest(team, opponent, score) {
    const scoring = team || 'Flamengo';
    const opp = opponent || 'Vasco';
    const scr = score || '1 x 0';
    this.triggerGoal(scoring, scr, opp, `${scoring} x ${opp}`);
    return this.activeAlert;
  }

  getActiveAlert() {
    if (!this.activeAlert) return null;
    if (Date.now() > this.activeAlert.expiresAt) {
      this.activeAlert = null;
      return null;
    }
    return this.activeAlert;
  }
}

const goalInstance = new GoalService();

module.exports = {
  goalService: goalInstance
};
