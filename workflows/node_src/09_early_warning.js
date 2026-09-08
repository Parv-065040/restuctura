// n8n Code node — "09 Early Warning" (optional / V2, deterministic only)
// Input: expects the same normalized `data` + `fin` shape produced by the
// main pipeline (pass the stored financial_snapshots row, or re-run
// 01-03 + 04-06 upstream of this node).

const input = $input.first().json;
const { data, fin } = input;

const warnings = [];

if (fin.cashBufferMonths !== null && fin.cashBufferMonths < 1) {
  warnings.push({
    type: 'LOW_CASH_BUFFER',
    message: 'Your cash reserve covers less than one month of your loan payments.',
    horizonDays: 30,
  });
}

if (fin.availableAfterEMI !== null && fin.availableAfterEMI < 0) {
  warnings.push({
    type: 'NEGATIVE_MONTHLY_CASHFLOW',
    message: 'Based on current figures, your monthly loan payments exceed the money left after expenses.',
    horizonDays: 30,
  });
}

if (data.business.incomeOutlook === 'Decrease' && fin.emiToAvailableRatio !== null && fin.emiToAvailableRatio > 0.5) {
  warnings.push({
    type: 'DECLINING_OUTLOOK_WITH_HIGH_EMI_SHARE',
    message: 'You expect income to fall over the next few months while EMI already takes up a large share of available cash. This combination raises repayment risk.',
    horizonDays: 60,
  });
}

if (fin.receivablesRatio !== null && fin.receivablesRatio > 0.4 && ['Yes', 'Sometimes'].includes(data.business.customersPayingLate)) {
  warnings.push({
    type: 'RECEIVABLES_BUILDUP',
    message: 'Money owed by customers is large relative to monthly sales and customers are paying late. This could delay your ability to pay EMIs on time.',
    horizonDays: 45,
  });
}

const hasWarning = warnings.length > 0;

return [{
  json: {
    earlyWarning: {
      hasWarning,
      summary: hasWarning
        ? 'Potential repayment stress detected in the next 30-60 days based on current figures.'
        : 'No early-warning signals detected from the information available.',
      warnings,
      disclaimer: 'This is an automated, rule-based signal from the figures provided — not a prediction or a lender assessment.',
    },
  },
}];
