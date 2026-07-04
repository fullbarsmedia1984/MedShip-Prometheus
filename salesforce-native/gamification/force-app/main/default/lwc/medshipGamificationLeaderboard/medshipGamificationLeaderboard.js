import { LightningElement, wire } from 'lwc';
import getCurrentMonthLeaderboard from '@salesforce/apex/MedshipGamificationLeaderboardController.getCurrentMonthLeaderboard';

export default class MedshipGamificationLeaderboard extends LightningElement {
    @wire(getCurrentMonthLeaderboard) rows;

    get rankedRows() {
        const rows = this.rows.data || [];
        return rows.map((row, index) => ({
            ...row,
            rank: index + 1
        }));
    }

    get hasRows() {
        return this.rows.data && this.rows.data.length > 0;
    }

    get isEmpty() {
        return this.rows.data && this.rows.data.length === 0;
    }
}
